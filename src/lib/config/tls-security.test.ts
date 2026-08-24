import { describe, expect, it } from "vitest";

import { assertTlsVerificationEnabled } from "./tls-security";

describe("assertTlsVerificationEnabled", () => {
  it.each([undefined, "", "1", " true "])(
    "accepts TLS verification setting %j",
    (value) => {
      expect(() => assertTlsVerificationEnabled(value)).not.toThrow();
    },
  );

  it("rejects the value that disables certificate verification", () => {
    expect(() => assertTlsVerificationEnabled(" 0 ")).toThrow(
      "NODE_TLS_REJECT_UNAUTHORIZED",
    );
  });
});
