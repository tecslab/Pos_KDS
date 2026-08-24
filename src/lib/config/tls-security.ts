/** Prevents the process from silently disabling HTTPS certificate verification. */
export function assertTlsVerificationEnabled(value: string | undefined): void {
  if (value?.trim() === "0") {
    throw new Error(
      "NODE_TLS_REJECT_UNAUTHORIZED must not be set to '0' because it disables HTTPS certificate verification.",
    );
  }
}
