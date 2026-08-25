/**
 * Request-scoped Postgres RLS bindings.
 *
 * Isolation is still `WHERE org_id = …` on each query. RLS is the second fence:
 * when `app.current_org_id` is set, a sloppy query cannot read another org's
 * rows, even as the table owner (`FORCE ROW LEVEL SECURITY`).
 *
 * Bindings live in AsyncLocalStorage and are applied with `SET LOCAL` on the
 * connection that actually runs the query (and `SET LOCAL ROLE openbot_rls` so
 * a superuser login cannot bypass). Replica B uses the same Postgres; a pool
 * hop cannot leak another org. Nothing is held in a Map.
 *
 * Empty `app.current_org_id` with bypass off is the boot / test / worker-claim
 * path: every row is visible. Authenticated tenant requests set the org id.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { SQL } from "bun";

export type RlsBinding = {
  orgId?: string | null;
  bypass?: boolean;
};

type StoredBinding = {
  orgId: string;
  bypass: boolean;
};

const rlsStore = new AsyncLocalStorage<StoredBinding>();

export function currentRlsBinding(): StoredBinding | undefined {
  return rlsStore.getStore();
}

type UnsafeClient = {
  unsafe: (
    query: string,
    params?: unknown[],
  ) => Promise<unknown> & { values?: () => Promise<unknown> };
  begin: <T>(fn: (tx: UnsafeClient) => Promise<T>) => Promise<T>;
};

async function applyBinding(
  tx: UnsafeClient,
  binding: StoredBinding,
): Promise<void> {
  await tx.unsafe(
    "select set_config('app.current_org_id', $1, true), set_config('app.bypass_rls', $2, true)",
    [binding.orgId, binding.bypass ? "on" : "off"],
  );
  await tx.unsafe("set local role openbot_rls");
}

function runWithBinding<T>(
  pool: UnsafeClient,
  binding: StoredBinding,
  work: (tx: UnsafeClient) => Promise<T> | T,
): Promise<T> {
  return pool.begin(async (tx) => {
    await applyBinding(tx, binding);
    return work(tx);
  });
}

type BoundQuery = Promise<unknown> & { values: () => Promise<unknown> };

/**
 * One execution of a bound query, in the shape Drizzle's bun-sql driver expects.
 *
 * That driver calls `unsafe(sql, params).values()` for any statement with a
 * RETURNING clause, including Better Auth's user / account / session inserts.
 * Bun's own query is lazy: constructing it does not run it, and `.values()`
 * only changes how the same execution is decoded.
 *
 * Running the statement when `unsafe` is called and again in `.values()` is
 * two transactions with the same primary key. The first commits. The second
 * is `users_pkey` / `accounts_pkey` / `sessions_pkey`, which Better Auth
 * reports as FAILED_TO_CREATE_USER. Sign-up then looks like a colliding
 * generator; the id was new, it was just inserted twice.
 *
 * Production binds RLS on every request, including `/api/auth/sign-up/email`
 * (`org_id` empty, every row visible). The wrapper is therefore on the
 * sign-up insert, not only on tenant-scoped reads.
 */
function boundUnsafe(
  pool: UnsafeClient,
  binding: StoredBinding,
  query: string,
  params: unknown[] | undefined,
): BoundQuery {
  const execute = (useValues: boolean) =>
    runWithBinding(pool, binding, (tx) => {
      const result = tx.unsafe(query, params);
      if (useValues && typeof result.values === "function") {
        return result.values();
      }
      return result;
    });

  let started: Promise<unknown> | undefined;
  const run = (useValues: boolean) => {
    started ??= execute(useValues);
    return started;
  };

  return {
    // Bun's sql.unsafe() is a Promise with `.values()`. Drizzle awaits one or
    // the other; a property named `then` is the contract, not a mistake.
    // biome-ignore lint/suspicious/noThenProperty: matches Bun SQL's lazy query
    then(
      onFulfilled?: ((value: unknown) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) {
      return run(false).then(onFulfilled, onRejected);
    },
    catch(onRejected?: ((reason: unknown) => unknown) | null) {
      return run(false).catch(onRejected);
    },
    finally(onFinally?: (() => void) | null) {
      return run(false).finally(onFinally ?? undefined);
    },
    values() {
      return run(true);
    },
  } as BoundQuery;
}

/**
 * Wrap the Bun SQL pool so every query on a bound request uses `SET LOCAL` on
 * that query's connection. Session GUCs on a random pooled connection are not
 * enough: the next statement might hop.
 *
 * Bound `unsafe` is lazy. See `boundUnsafe`: Drizzle's bun-sql driver follows
 * `unsafe` with `.values()` for RETURNING, and those must be one execution.
 */
export function wrapClientWithRls(client: SQL): SQL {
  const pool = client as unknown as UnsafeClient;
  return new Proxy(client, {
    apply(target, thisArg, argArray) {
      return Reflect.apply(
        target as unknown as (...args: never[]) => unknown,
        thisArg,
        argArray,
      );
    },
    get(target, prop, receiver) {
      if (prop === "unsafe") {
        return (query: string, params?: unknown[]) => {
          const binding = rlsStore.getStore();
          if (!binding) {
            return pool.unsafe(query, params);
          }
          return boundUnsafe(pool, binding, query, params);
        };
      }
      if (prop === "begin") {
        return <T>(fn: (tx: UnsafeClient) => Promise<T>) => {
          const binding = rlsStore.getStore();
          if (!binding) {
            return pool.begin(fn);
          }
          return runWithBinding(pool, binding, fn);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as SQL;
}

export async function bindRequestRls(
  _database: unknown,
  input: RlsBinding = {},
): Promise<void> {
  rlsStore.enterWith({
    orgId: input.orgId?.trim() ?? "",
    bypass: input.bypass === true,
  });
}
