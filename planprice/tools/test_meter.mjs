// Unit checks for Batch F helpers (PP-SEAT-BUCKET-COST).
import { billedSeats } from "./savings.mjs";
let n = 0;
const eq = (a, b, label) => { n++; if (a !== b) throw new Error(`${label}: ${a} !== ${b}`); };
eq(billedSeats(1), 3, "1 person bills the 3-seat minimum");
eq(billedSeats(3), 3, "3 people bill 3");
eq(billedSeats(4), 5, "4 people bill 5 (vendor example)");
eq(billedSeats(5), 5, "5 people bill 5");
eq(billedSeats(6), 10, "6 people bill 10 (vendor example)");
eq(billedSeats(10), 10, "10 people bill 10");
eq(billedSeats(11), 15, "11 people bill 15");
eq(billedSeats(25), 25, "25 people bill 25");
eq(billedSeats(0), null, "0 is not a team");
eq(billedSeats(NaN), null, "NaN rejected");
console.log(`test_meter: all ${n} assertions passed`);
