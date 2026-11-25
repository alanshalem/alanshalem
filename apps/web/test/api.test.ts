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
  it('en un build pide los datos una sola vez y reutiliza la respuesta', async () => {
    const loader = countingLoader();
    const get = oncePerBuild(loader.load, () => false);

    assert.equal(await get(), 1);
    assert.equal(await get(), 1);
    assert.equal(loader.calls(), 1);
  });

  it('en el servidor de desarrollo pide los datos en cada llamada, así se ven los cambios del admin', async () => {
    const loader = countingLoader();
    const get = oncePerBuild(loader.load, () => true);

    assert.equal(await get(), 1);
    assert.equal(await get(), 2);
    assert.equal(loader.calls(), 2);
  });

  it('en desarrollo un fallo no queda guardado: la llamada siguiente vuelve a intentar', async () => {
    let fail = true;
    const get = oncePerBuild(async () => {
      if (fail) throw new Error('API caída');
      return 'ok';
    }, () => true);

    await assert.rejects(get(), /API caída/);
    fail = false;
    assert.equal(await get(), 'ok');
  });
});
