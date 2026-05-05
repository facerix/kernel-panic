// uuid.js -- tools for generating & working with UUIDs

// the best format for our purposes will be v4 (variant 1), which looks like the following:
//    xxxxxxxx-xxxx-4xxx-Nxxx-xxxxxxxxxxxx
// Note that the first digit of the third word is always 4; this indicates the ID's spec version
// N represents the specific variant of v4; variant 1 will have the higher two bits set to `0x10`
// (so that hex digit will always be 8, 9, a, or b, varying depending on the underlying random data)

const getCurrTimestampAsHex = () => {
  return new Date().getTime().toString(16).slice(0, 8);
};

const getRandomHexSequence = digits => {
  const seq = [];
  for (let i = 0; i < digits; i++) {
    seq[i] = ((Math.random() * 16) | 0).toString(16);
  }
  return seq.join('');
};

const getRandomV4Var1Digit = () => {
  return (((Math.random() * 16) & 0x3) | 0x8).toString(16);
};

export const v4 = () => {
  return [
    getRandomHexSequence(8),
    getRandomHexSequence(4),
    `4${getRandomHexSequence(3)}`,
    `${getRandomV4Var1Digit()}${getRandomHexSequence(3)}`,
    getRandomHexSequence(12),
  ].join('-');
};

/*
There are several variations of timestamp-first UUIDs in different implementations because
there is not agreed upon specification. However, generally the first 8 hex digits represent
the time and the remaining digits are random.
– https://www.uuidtools.com/uuid-versions-explained#timestamp-first
*/

export const v4WithTimestamp = () => {
  return [
    getCurrTimestampAsHex(),
    getRandomHexSequence(4),
    `4${getRandomHexSequence(3)}`,
    `${getRandomV4Var1Digit()}${getRandomHexSequence(3)}`,
    getRandomHexSequence(12),
  ].join('-');
};
