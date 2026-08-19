export class SupabaseRealtimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseRealtimeError";
  }
}
