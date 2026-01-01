import * as THREE from "three/webgpu";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

// HDRI (RGBE) loader cache
// - 複数シーンで同じHDRを何度もloadしない（GPUメモリ/初期化時間の節約）
// - file(=importされたURL文字列)ごとにPromiseをキャッシュする
const _hdrPromiseCache = new Map();

export function loadHdrCached(file) {
  if (!file) throw new Error("loadHdrCached: file is required");
  const key = String(file);
  const cached = _hdrPromiseCache.get(key);
  if (cached) return cached;

  const p = new Promise((resolve, reject) => {
    new RGBELoader().load(
      file,
      (result) => {
        try {
          result.mapping = THREE.EquirectangularReflectionMapping;
          resolve(result);
        } catch (e) {
          reject(e);
        }
      },
      undefined,
      (err) => reject(err)
    );
  });

  _hdrPromiseCache.set(key, p);
  return p;
}


