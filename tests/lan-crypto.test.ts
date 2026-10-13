import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {randomId,sha256Hex} from '../src/core/crypto';
import {assetHash} from '../src/platform/portableAssets';
afterEach(()=>vi.unstubAllGlobals());
function lanCrypto(){vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)});}
it('creates distinct valid project IDs when HTTP hides randomUUID',()=>{
 lanCrypto();const ids=Array.from({length:100},()=>randomId());
 expect(new Set(ids).size).toBe(100);
 for(const id of ids)expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
it('retains asset identity on LAN HTTP, including sliced binary data',async()=>{
 const bytes=new TextEncoder().encode('_abc_').subarray(1,4);
 const expected='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
 expect(await assetHash(bytes)).toBe(expected);
 lanCrypto();expect(await assetHash(bytes)).toBe(expected);
 expect(await sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
