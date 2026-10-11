import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

// Guards on the generated client, built from prisma/schema.prisma.

describe("generated client: Site", () => {
  // #445: Site.blueprintType is @ignore so no deployed client reads or writes
  // the column before it is dropped. Removing the @ignore early would make the
  // client select and insert it again; this goes red if that happens.
  it("does not know Site.blueprintType", () => {
    const fields = Object.keys(Prisma.SiteScalarFieldEnum);
    expect(fields).toContain("status");
    expect(fields).not.toContain("blueprintType");
  });
});
