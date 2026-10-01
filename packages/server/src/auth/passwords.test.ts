import { describe, expect, it } from "vitest";
import { BusyError, ConcurrencyLimiter } from "./concurrency.js";
import {
  ARGON2_PARAMETERS,
  isCommonPassword,
  PASSWORD_MAX_LENGTH,
  PasswordHasher,
  passwordProblem,
} from "./passwords.js";

const hasher = new PasswordHasher({ concurrency: 2, maxQueued: 10 });

describe("PasswordHasher", () => {
  it("uses at least the OWASP recommendation for Argon2id", () => {
    expect(ARGON2_PARAMETERS.memory).toBeGreaterThanOrEqual(19_456);
    expect(ARGON2_PARAMETERS.passes).toBeGreaterThanOrEqual(2);
    expect(ARGON2_PARAMETERS.parallelism).toBeGreaterThanOrEqual(1);
  });

  it("records the parameters in the hash and verifies the password", async () => {
    const hash = await hasher.hash("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[\w-]{22}\$[\w-]{43}$/);
    expect(await hasher.verify(hash, "correct horse battery staple")).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect(await hasher.verify(hash, "correct horse battery stapl")).toEqual({
      valid: false,
      needsRehash: false,
    });
    expect(await hasher.hash("correct horse battery staple")).not.toBe(hash);
  });

  it("treats composed and decomposed Unicode as the same password", async () => {
    const hash = await hasher.hash("Mädchenname!");
    expect((await hasher.verify(hash, "Mädchenname!")).valid).toBe(true);
  });

  it("asks for a new hash when the parameters change", async () => {
    const old = new PasswordHasher({
      concurrency: 1,
      maxQueued: 1,
      parameters: { memory: 9216, passes: 4, parallelism: 1 },
    });
    const hash = await old.hash("a long passphrase");
    expect(await hasher.verify(hash, "a long passphrase")).toEqual({ valid: true, needsRehash: true });
  });

  it("rejects hashes in an unknown format", async () => {
    await expect(hasher.verify("$2b$10$abcdefghijklmnopqrstuv", "x")).rejects.toThrow("unknown format");
  });

  it("spends time on unknown accounts without a stored hash", async () => {
    await expect(hasher.verifyNothing("anything")).resolves.toBeUndefined();
  });
});

describe("ConcurrencyLimiter", () => {
  it("runs at most the limit at once and rejects beyond the queue", async () => {
    const limiter = new ConcurrencyLimiter({ limit: 2, maxQueued: 1 });
    const releases: (() => void)[] = [];
    let peak = 0;
    const task = () =>
      limiter.run(
        () =>
          new Promise<void>((resolve) => {
            peak = Math.max(peak, limiter.running);
            releases.push(resolve);
          }),
      );
    const running = [task(), task(), task()];
    await expect(task()).rejects.toThrow(BusyError);
    expect(limiter.running).toBe(2);
    expect(limiter.queued).toBe(1);
    while (releases.length > 0 || limiter.running > 0) {
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all(running);
    expect(peak).toBe(2);
    expect(limiter.running).toBe(0);
  });

  it("releases the slot when a task fails", async () => {
    const limiter = new ConcurrencyLimiter({ limit: 1, maxQueued: 0 });
    await expect(limiter.run(() => Promise.reject(new Error("failed")))).rejects.toThrow("failed");
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
});

describe("password policy", () => {
  it("requires the minimum length in characters, not bytes", () => {
    expect(passwordProblem("short", 12)).toBe("tooShort");
    expect(passwordProblem("äöüäöüäöüäöü", 12)).toBeNull();
    expect(passwordProblem("x".repeat(PASSWORD_MAX_LENGTH + 1), 12)).toBe("tooLong");
  });

  it("has no composition rules", () => {
    expect(passwordProblem("only lower case words here", 12)).toBeNull();
  });

  it("rejects common passwords regardless of case", () => {
    expect(isCommonPassword("password")).toBe(true);
    expect(isCommonPassword("PassWord1234")).toBe(true);
    expect(passwordProblem("Password1234", 8)).toBe("common");
    expect(passwordProblem("qwertyuiop", 8)).toBe("common");
    expect(isCommonPassword("violet tram umbrella")).toBe(false);
  });
});
