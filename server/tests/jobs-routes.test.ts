import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import type { ScheduleGateway } from "../src/jobs/gateway";
import { testEnvironment } from "./support/environment";

const ADMIN = {
  id: "admin-1",
  email: "admin@openbot.test",
  name: "An Administrator",
  image: null,
};

function appWith(gateway: Partial<ScheduleGateway>) {
  const app = createApp(
    loadConfig(testEnvironment()),
    {
      handler: () => new Response(null, { status: 204 }),
      api: { getSession: async () => ({ user: ADMIN }) },
    } as never,
    { rolesForUser: async () => ["admin"] },
    ...(Array.from({ length: 19 }) as never[]),
    gateway as ScheduleGateway,
  );
  return (path: string, init?: RequestInit) =>
    app.request(`http://openbot.test${path}`, init);
}

describe("schedule routes", () => {
  test("lists schedules for an administrator", async () => {
    const request = appWith({
      list: async () => [],
    });
    const response = await request("/api/admin/schedules");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schedules: [] });
  });

  test("a webhook trigger returns 202 without waiting for the run", async () => {
    let fired = false;
    const request = appWith({
      fireInbound: async () => {
        fired = true;
        return {
          ok: true,
          run: {
            id: "run_1",
            jobId: "job_1",
            status: "queued",
            trigger: "webhook",
            result: null,
            error: null,
            startedAt: null,
            finishedAt: null,
            createdAt: new Date("2026-01-15T00:00:00.000Z"),
          },
          job: {} as never,
        };
      },
    });
    const response = await request("/api/triggers/job_1", {
      method: "POST",
      headers: {
        authorization: "Bearer obot_job_testsecret",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(fired).toBe(true);
    expect(response.status).toBe(202);
  });

  test("the HTTP trigger route never marks the caller trusted", async () => {
    let received: { trusted?: boolean } | undefined;
    const request = appWith({
      fireInbound: async (input) => {
        received = input;
        return {
          ok: false,
          error: "A valid trigger secret is required.",
          status: 403,
        };
      },
    });
    await request("/api/triggers/job_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: "email" }),
    });
    expect(received?.trusted).toBeUndefined();
  });

  test("a refused trigger does not invent a run", async () => {
    const request = appWith({
      fireInbound: async () => ({
        ok: false,
        error: "A valid trigger secret is required.",
        status: 403,
      }),
    });
    const response = await request("/api/triggers/job_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
  });
});
