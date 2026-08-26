/**
 * Seats are capacity, and every mistake here is a wrong charge.
 *
 * `decide` is pure precisely so the whole model can be walked through without a
 * network: a seat bought when one was already free is somebody billed twice, a
 * release scheduled twice is a 409 from Dodo, and a release left standing after
 * the seat is refilled takes a seat away from a team that is still using it.
 * None of those show up in a response — they show up on an invoice.
 */
import { describe, expect, it } from "vitest";

import { decide, quotaFor, seatsNeeded, type SeatState } from "../src/lib/seats.ts";

/** Nothing bought, nothing scheduled: a team that has just subscribed. */
const fresh: SeatState = { seatsPurchased: 0, scheduledSeats: null };

describe("seatsNeeded", () => {
  it("does not count the seat the product includes", () => {
    expect(seatsNeeded(1)).toBe(0);
    expect(seatsNeeded(2)).toBe(1);
    expect(seatsNeeded(5)).toBe(4);
  });

  it("never goes negative", () => {
    // A team with no members at all is not a real state, but arithmetic that
    // returns -1 would be sent to Dodo as a quantity.
    expect(seatsNeeded(0)).toBe(0);
  });
});

describe("decide", () => {
  it("buys a seat when a member joins a full team", () => {
    expect(decide(1, fresh)).toEqual({ kind: "buy", seats: 1 });
  });

  it("buys up to the total, not by one", () => {
    // The quantity sent to Dodo replaces the add-on outright. A team of six
    // that has drifted to one purchased seat has to end at five, not two.
    expect(decide(5, { seatsPurchased: 1, scheduledSeats: null })).toEqual({
      kind: "buy",
      seats: 5,
    });
  });

  it("charges nothing when a member joins into a seat that is already paid for", () => {
    // The whole point of seats being capacity: this is the refill after a
    // removal, and it must not reach Dodo as a purchase.
    expect(decide(2, { seatsPurchased: 2, scheduledSeats: null })).toEqual({ kind: "none" });
  });

  it("schedules a release rather than crediting one when a member is removed", () => {
    expect(decide(1, { seatsPurchased: 2, scheduledSeats: null })).toEqual({
      kind: "schedule",
      seats: 1,
    });
  });

  it("does not schedule the same release twice", () => {
    // Dodo answers 409 when a plan change is already scheduled, and this runs
    // again on every membership change and on every hourly sweep.
    expect(decide(1, { seatsPurchased: 2, scheduledSeats: 1 })).toEqual({ kind: "none" });
  });

  it("replaces a scheduled release when another member leaves", () => {
    expect(decide(1, { seatsPurchased: 3, scheduledSeats: 2 })).toEqual({
      kind: "schedule",
      seats: 1,
    });
  });

  it("drops the pending release when the freed seat is filled again", () => {
    // Back at capacity with a release still standing. Left alone, the team
    // loses a seat at renewal that it is currently using.
    expect(decide(2, { seatsPurchased: 2, scheduledSeats: 1 })).toEqual({ kind: "unschedule" });
  });

  it("buys past a pending release rather than queueing behind it", () => {
    // Growing beyond what was scheduled to be released. `setSeats` cancels the
    // schedule as part of the same call, which is why this is one action.
    expect(decide(4, { seatsPurchased: 3, scheduledSeats: 1 })).toEqual({ kind: "buy", seats: 4 });
  });

  it("does nothing on a team that is exactly settled", () => {
    expect(decide(0, fresh)).toEqual({ kind: "none" });
    expect(decide(3, { seatsPurchased: 3, scheduledSeats: null })).toEqual({ kind: "none" });
  });

  it("is stable when run again on the state its own action produced", () => {
    // What makes a dropped hook, a retried webhook and the hourly sweep safe to
    // run over each other: the second pass must find nothing left to do.
    const bought = decide(2, fresh);
    expect(bought).toEqual({ kind: "buy", seats: 2 });
    expect(decide(2, { seatsPurchased: 2, scheduledSeats: null })).toEqual({ kind: "none" });

    const scheduled = decide(1, { seatsPurchased: 2, scheduledSeats: null });
    expect(scheduled).toEqual({ kind: "schedule", seats: 1 });
    expect(decide(1, { seatsPurchased: 2, scheduledSeats: 1 })).toEqual({ kind: "none" });

    expect(decide(2, { seatsPurchased: 2, scheduledSeats: 1 })).toEqual({ kind: "unschedule" });
    expect(decide(2, { seatsPurchased: 2, scheduledSeats: null })).toEqual({ kind: "none" });
  });
});

describe("quotaFor", () => {
  it("counts the included seat", () => {
    // A team that has bought nothing still has the owner's seat. Off by one
    // here halves what a solo Pro user is allowed to store.
    expect(quotaFor(0)).toBe(25 * 1024 * 1024 * 1024);
    expect(quotaFor(3)).toBe(4 * 25 * 1024 * 1024 * 1024);
  });
});
