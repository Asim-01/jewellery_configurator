// Application clock. All lock/expiry decisions go through here so tests can
// move time forward instead of sleeping for 10 minutes.
let offsetMs = 0;

export const clock = {
  now: () => new Date(Date.now() + offsetMs),
  advance: (ms) => {
    offsetMs += ms;
  },
  reset: () => {
    offsetMs = 0;
  },
};
