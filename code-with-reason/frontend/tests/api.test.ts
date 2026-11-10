import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  evaluateCode,
  getProblems,
  getSession,
  resetSession,
} from "@/lib/api";
import { makeResult } from "./fixtures";

describe("existing API transport", () => {
  it("keeps evaluation actions and request fields on the versioned route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => makeResult() });
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      session_id: "session-1",
      problem_id: "two-sum-sorted",
      user_code: "def solve(): return 1",
      user_message: "I think this invariant holds.",
      action: "request_next_tier" as const,
    };
    await evaluateCode(request);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/evaluate");
    expect(options.method).toBe("POST");
    expect(options.cache).toBe("no-store");
    expect(JSON.parse(options.body)).toEqual(request);
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("encodes session identifiers and retains the session-specific reset route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await getSession("session / one");
    await resetSession("session / one");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/sessions/session%20%2F%20one",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/v1/sessions/session%20%2F%20one/reset",
    );
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("retains server errors and distinguishes connection failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ detail: "Session belongs to another problem" }),
      })
      .mockRejectedValueOnce(new TypeError("connection refused"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getProblems()).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: "Session belongs to another problem",
    });
    await expect(getProblems()).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("Cannot reach"),
    });
  });

  it("aborts after 15 seconds and reports a retryable timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = getProblems();
    const assertion = expect(response).rejects.toMatchObject({
      status: 408,
      message: expect.stringContaining("timed out"),
    });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(new ApiError("test", 409)).toBeInstanceOf(Error);
  });
});
