import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createLearningBridge } from "../scripts/learning-bridge.mjs";
import { createLearningEncoder } from "../src/learning-observation.mjs";
import {
  createTeamBattle,
  stepTeamBattle,
  teamMoveCost,
} from "../src/team-engine.mjs";
import {
  createPilotMemory,
  pilotObservation,
  rememberPilotStep,
} from "../src/pilot-observation.mjs";

const data = JSON.parse(
  await readFile(
    new URL("../public/data/team-2026-10-14.json", import.meta.url),
  ),
);
function fixture() {
  const state = createTeamBattle(
    data,
    data.teams[0].members,
    data.teams[1].members,
  );
  const memory = createPilotMemory(0);
  rememberPilotStep(
    memory,
    stepTeamBattle(data, state, ["switch:0", "switch:0"]),
    state,
  );
  return { state, memory, encoder: createLearningEncoder(data) };
}
test("encoded inputs and mask are invariant to opponent hidden configuration", () => {
  const { state, memory, encoder } = fixture();
  const before = encoder.encode(
    pilotObservation(data, state, 0, structuredClone(memory)),
  );
  const changed = structuredClone(state),
    p = changed.sides[1].pets[2];
  p.id = "SECRET";
  p.moves.reverse();
  p.energy = 0;
  p.stats.atk = 9999;
  changed.sides[1].pets[0].stats.def = 9999;
  changed.sides[1].pets[0].moves.reverse();
  changed.pendingCommands = ["SECRET"];
  const after = encoder.encode(
    pilotObservation(data, changed, 0, structuredClone(memory)),
  );
  assert.deepEqual(before, after);
  assert.equal(before.pets.length, 12);
  assert.equal(before.actions.length, 12);
  assert.ok(Object.values(before).flat(Infinity).every(Number.isFinite));
});
test("action slots roundtrip legal moves and reject masked actions", () => {
  const { state, memory, encoder } = fixture();
  const view = pilotObservation(data, state, 0, memory),
    encoded = encoder.encode(view);
  for (let i = 0; i < 12; i++)
    if (encoded.mask[i])
      assert.ok(view.legalActions.includes(encoder.command(view, i)));
    else assert.throws(() => encoder.command(view, i), /Masked/);
  state.sides[0].pets[0].energy = 0;
  const low = pilotObservation(data, state, 0, memory),
    lower = encoder.encode(low);
  for (let i = 0; i < 4; i++)
    if (
      teamMoveCost(
        data,
        state.sides[0].pets[0],
        state.sides[0].pets[0].moves[i],
      ) > 0
    )
      assert.equal(lower.mask[i], 0);
});
test("encoder uses publicly known current move costs", () => {
  const { state, memory, encoder } = fixture();
  state.sides[0].pets[0].costReduction = 2;
  const view = pilotObservation(data, state, 0, memory),
    encoded = encoder.encode(view);
  const at = encoder.schema.actionNames.indexOf("cost");
  for (let i = 0; i < 4; i++)
    assert.equal(
      encoded.actions[i][at],
      teamMoveCost(
        data,
        state.sides[0].pets[0],
        state.sides[0].pets[0].moves[i],
      ) / 10,
    );
});
test("batch validation is atomic; bridge refuses formal scope", async () => {
  const a = await createLearningBridge(),
    b = await createLearningBridge();
  const x = a.request({ op: "init", envs: 2, seed: 42 }),
    y = b.request({ op: "init", envs: 2, seed: 42 });
  assert.equal(x.executionHash, y.executionHash);
  assert.deepEqual(x.observations, y.observations);
  const actions = x.observations.map((v) => v.rules.map((p) => p.attack));
  assert.throws(
    () => a.request({ op: "step", actions: [actions[0], [11, 11]] }),
    /Masked/,
  );
  assert.deepEqual(
    a.request({ op: "step", actions }),
    b.request({ op: "step", actions }),
  );
  assert.throws(() => a.request({ op: "init", scope: "formal" }), /prototype/);
  assert.equal(
    new Set(
      [...x.split.train, ...x.split.validation, ...x.split.test].map((t) =>
        JSON.stringify(t.members),
      ),
    ).size,
    8,
  );
});
test("visible rules complete games, terminal rewards are zero-sum and reset is explicit", async () => {
  const bridge = await createLearningBridge();
  let current = bridge.request({ op: "init", envs: 1, seed: 42 })
    .observations[0];
  let result;
  for (let i = 0; i < 220; i++) {
    result = bridge.request({
      op: "step",
      actions: [current.rules.map((p) => p.attack)],
      autoReset: false,
    })[0];
    assert.equal(result.rewards[0] + result.rewards[1], 0);
    if (result.done) break;
    current = result.next;
  }
  assert.ok(result.done);
  assert.equal(result.next, null);
  assert.ok(
    ["prototype-victory", "prototype-round-cap"].includes(
      result.terminal.endReason,
    ),
  );
  assert.throws(
    () => bridge.request({ op: "step", actions: [[5, 5]] }),
    /reset/,
  );
  assert.ok(bridge.request({ op: "reset" }).observation[0].mask.some(Boolean));
});
