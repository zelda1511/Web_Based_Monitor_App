// One cleaning at a time: the Cleanup page and the automatic cleaning share this, so they can never delete in the same folders together.
let held = null;

// Returns a function that gives the turn back, or null when someone else holds it.
function acquire(who) {
  if (held) return null;
  held = who;
  let given = false;
  return () => {
    if (given) return;
    given = true;
    held = null;
  };
}

module.exports = { acquire, heldBy: () => held, _reset: () => { held = null; } };
