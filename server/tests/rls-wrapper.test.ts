import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { bindRequestRls, wrapClientWithRls } from "../src/db/rls";

/**
 * The request RLS wrapper used to run a bound query when `unsafe` was called
 * and again when Drizzle asked for `.values()`. INSERT ... RETURNING is that
 * shape. Two executions of the same primary key is FAILED_TO_CREATE_USER.
 */
type FakeResult = Promise<unknown> & { values: () => Promise<unknown> };

function fakeClient() {
  const inserts: string[] = [];
  const client = {
    unsafe(query: string, _params?: unknown[]) {
      if (/\binsert\b/i.test(query)) {
        inserts.push(query);
      }
      const rows = [{ id: "new-id" }];
      const arrays = [["new-id"]];
      const result = Promise.resolve(rows) as FakeResult;
      result.values = () => Promise.resolve(arrays);
      return result;
    },
    async begin<T>(fn: (tx: typeof client) => Promise<T>) {
      return fn(client);
    },
  };
  return { client, inserts };
}

async function boundUnsafe(
  client: ReturnType<typeof fakeClient>["client"],
  query: string,
) {
  const wrapped = wrapClientWithRls(client as unknown as SQL);
  await bindRequestRls(undefined, { orgId: "org_local", bypass: false });
  return (
    wrapped as unknown as {
      unsafe: (
        query: string,
        params?: unknown[],
      ) => Promise<unknown> & { values: () => Promise<unknown> };
    }
  ).unsafe(query, ["new-id"]);
}

describe("request RLS bun-sql wrapper", () => {
  test("unsafe().values() runs a bound INSERT once", async () => {
    const { client, inserts } = fakeClient();
    await (
      await boundUnsafe(
        client,
        'insert into "users" ("id") values ($1) returning "id"',
      )
    ).values();
    expect(inserts).toEqual([
      'insert into "users" ("id") values ($1) returning "id"',
    ]);
  });

  test("await unsafe() without .values() still runs a bound INSERT once", async () => {
    const { client, inserts } = fakeClient();
    await boundUnsafe(
      client,
      'insert into "users" ("id") values ($1) returning "id"',
    );
    expect(inserts).toEqual([
      'insert into "users" ("id") values ($1) returning "id"',
    ]);
  });
});
