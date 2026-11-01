import { describe, expect, it } from "vitest";
import { isReadOnlyQuery } from "./database.js";

describe("read-only queries", () => {
  it("keeps the request cache for selects and read-only common table expressions", () => {
    expect(isReadOnlyQuery("select id from accounts where id = $1")).toBe(true);
    expect(isReadOnlyQuery("with targets as (select t.id from tree_items t) select * from targets")).toBe(
      true,
    );
    expect(isReadOnlyQuery("  WITH RECURSIVE up as (select 1) select updated_at from up")).toBe(true);
  });

  it("clears the request cache for every statement that can change data", () => {
    expect(isReadOnlyQuery("insert into accounts (id) values ($1)")).toBe(false);
    expect(isReadOnlyQuery("update sessions set last_used_at = $1")).toBe(false);
    expect(isReadOnlyQuery("delete from sessions where id = $1")).toBe(false);
    expect(
      isReadOnlyQuery("with gone as (delete from sessions returning id) select count(*) from gone"),
    ).toBe(false);
    expect(isReadOnlyQuery("with changed as (update tree_items set title = $1 returning id) select 1")).toBe(
      false,
    );
    expect(isReadOnlyQuery("select id from accounts where id = $1 for update")).toBe(false);
    expect(isReadOnlyQuery("truncate mail_sends")).toBe(false);
    expect(isReadOnlyQuery("merge into tree_items using x on true when matched then do nothing")).toBe(false);
  });
});
