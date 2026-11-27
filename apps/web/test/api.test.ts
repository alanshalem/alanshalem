import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { oncePerBuild } from '../src/lib/api.ts';

function countingLoader() {
  let calls = 0;
  return {
    load: async () => ++calls,
    calls: () => calls,
  };
}

describe('oncePerBuild', () => {
  it('in a build it fetches the data once and reuses the response', async () => {
    const loader = countingLoader();
    const get = oncePerBuild(loader.load, () => false);

    assert.equal(await get(), 1);
    assert.equal(await get(), 1);
    assert.equal(loader.calls(), 1);
  });

  it('on the dev server it fetches the data on every call, so the admin changes show up', async () => {
    const loader = countingLoader();
    const get = oncePerBuild(loader.load, () => true);

    assert.equal(await get(), 1);
    assert.equal(await get(), 2);
    assert.equal(loader.calls(), 2);
  });

  it('in development a failure is not cached: the next call tries again', async () => {
    let fail = true;
    const get = oncePerBuild(async () => {
      if (fail) throw new Error('API down');
      return 'ok';
    }, () => true);

    await assert.rejects(get(), /API down/);
    fail = false;
    assert.equal(await get(), 'ok');
  });
});
