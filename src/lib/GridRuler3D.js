import * as THREE from 'three/webgpu';

/**
 * GridRuler3D
 * - 床(XZ) + 垂直面(XY, YZ)の格子
 * - 主要目盛り(0/16/32/48/64)のラベルをSpriteで表示
 * - すべて unlit (LineBasic / SpriteMaterial) なのでライティング非依存
 * - Sceneに置くので遮蔽(Zテスト)が効く
 */
export class GridRuler3D {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'GridRuler3D';
    this._labelSprites = [];
    this._materials = [];
    this._labelScale = 1.0;
  }

  dispose() {
    this._labelSprites.forEach((s) => {
      if (s.material?.map) s.material.map.dispose();
      s.material?.dispose?.();
    });
    this._materials.forEach((m) => m.dispose?.());
    this.group.traverse((o) => {
      if (o.geometry?.dispose) o.geometry.dispose();
    });
  }

  setVisible(v) {
    this.group.visible = !!v;
  }

  /**
   * @param {{
   *  center: {x:number,y:number,z:number},
   *  size: {x:number,y:number,z:number},
   *  divX?:number, divY?:number, divZ?:number,
   *  labelMax?:number,
   *  floorY?:number,
   *  color?:number,
   *  opacity?:number
   * }} params
   */
  init(params) {
    const center = params.center;
    const size = params.size;
    if (!center || !size) return;

    // Scene01準拠のデフォルト値（Scene側は基本「箱サイズ」だけ渡せばOK）
    const divX = Math.max(2, Number(params.divX ?? 12));
    const divY = Math.max(2, Number(params.divY ?? 10));
    const divZ = Math.max(2, Number(params.divZ ?? 8));
    // Scene01で採用している「箱サイズに対して少し余白」スケール
    const floorSize = Number(params.floorSize ?? (Math.max(size.x, size.z) * 2.2));
    const floorDivisions = Math.max(2, Number(params.floorDivisions ?? 40));
    // 「赤い十字」は 0/16/32/48/64 に出す設計なのでデフォは 64
    const labelMax = Number(params.labelMax ?? 64);

    const color = Number(params.color ?? 0xffffff);
    const opacity = Number(params.opacity ?? 0.65);

    const cx = center.x, cy = center.y, cz = center.z;
    const sx = size.x, sy = size.y, sz = size.z;

    // ラベル（数字）が「出てないように見える」問題の対策:
    // - シーンのスケールに合わせてスプライトサイズを自動スケール
    // - 粒や床に隠れないよう、ラベルは常に前面表示（depthTest=false）
    const baseScale = Math.max(sx, sy, sz, floorSize);
    this._labelScale = Number(params.labelScale ?? (baseScale * 0.04));

    const minX = cx - sx * 0.5, maxX = cx + sx * 0.5;
    const minY = cy - sy * 0.5, maxY = cy + sy * 0.5;
    const minZ = cz - sz * 0.5, maxZ = cz + sz * 0.5;
    const floorY = (params.floorY ?? (minY - 0.002));

    // Line material (unlit)
    const lineMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false
    });
    this._materials.push(lineMat);

    // --- floor grid (XZ) : big one only
    const fMinX = cx - floorSize * 0.5;
    const fMaxX = cx + floorSize * 0.5;
    const fMinZ = cz - floorSize * 0.5;
    const fMaxZ = cz + floorSize * 0.5;
    this.group.add(this._makeGridXZ(fMinX, fMaxX, fMinZ, fMaxZ, floorY, floorDivisions, floorDivisions, lineMat));

    // --- rulers (ticks + labels)
    // 要望:
    // - 垂直グリッドは無し
    // - 目盛りは「X軸の真ん中」と「Z軸の外側」だけ
    //
    // X: 床の中心線 (z=cz)
    // Z: 床の右外周 (x=fMaxX)
    this.group.add(this._makeRulerX(fMinX, fMaxX, floorY, cz, labelMax, color));
    this.group.add(this._makeRulerZ(fMinZ, fMaxZ, floorY, fMaxX, labelMax, color));
  }

  update(camera) {
    // label sprites should face camera (billboard)
    if (!camera) return;
    this._labelSprites.forEach((s) => {
      s.quaternion.copy(camera.quaternion);
    });
  }

  _makeGridXZ(minX, maxX, minZ, maxZ, y, divX, divZ, mat) {
    const verts = [];
    for (let i = 0; i <= divX; i++) {
      const t = i / divX;
      const x = minX + (maxX - minX) * t;
      verts.push(x, y, minZ, x, y, maxZ);
    }
    for (let k = 0; k <= divZ; k++) {
      const t = k / divZ;
      const z = minZ + (maxZ - minZ) * t;
      verts.push(minX, y, z, maxX, y, z);
    }
    return this._linesFromVerts(verts, mat, 'gridFloorXZ');
  }

  // 垂直グリッドは要望により撤去

  _linesFromVerts(verts, mat, name) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const lines = new THREE.LineSegments(geom, mat);
    lines.frustumCulled = false;
    lines.name = name;
    return lines;
  }

  _makeRulerX(minX, maxX, y, z, labelMax, color) {
    const group = new THREE.Group();
    group.name = 'rulerX';
    const tickLen = 0.015;
    const verts = [];
    const crossSize = 0.02;

    // ticks every 8 units in label space (0..64)
    for (let v = 0; v <= labelMax; v += 8) {
      const t = v / labelMax;
      const x = minX + (maxX - minX) * t;
      verts.push(x, y, z, x, y + tickLen, z);
    }
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: true, depthWrite: false });
    this._materials.push(mat);
    group.add(this._linesFromVerts(verts, mat, 'ticksX'));

    // 赤い小さな十字（数字が表示される位置だけ / X軸中心線）
    const crossVerts = [];
    for (let v = 0; v <= labelMax; v += 8) {
      if (v % 16 !== 0) continue; // ラベル位置に合わせる（0/16/32/48/64）
      const t = v / labelMax;
      const x = minX + (maxX - minX) * t;
      // X方向の短い線
      crossVerts.push(x - crossSize, y + 0.0005, z, x + crossSize, y + 0.0005, z);
      // Z方向の短い線
      crossVerts.push(x, y + 0.0005, z - crossSize, x, y + 0.0005, z + crossSize);
    }
    if (crossVerts.length) {
      const crossMat = new THREE.LineBasicMaterial({
        color: 0xff3333,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: false
      });
      this._materials.push(crossMat);
      group.add(this._linesFromVerts(crossVerts, crossMat, 'labelCrossX'));
    }

    for (let v = 0; v <= labelMax; v += 8) {
      if (v % 16 !== 0) continue; // ラベルは間引き（0/16/32/48/64）
      const t = v / labelMax;
      const x = minX + (maxX - minX) * t;
      group.add(this._makeLabelSprite(String(v), new THREE.Vector3(x, y + tickLen * 2.2, z), color));
    }
    return group;
  }

  _makeRulerZ(minZ, maxZ, y, x, labelMax, color) {
    const group = new THREE.Group();
    group.name = 'rulerZ';
    const tickLen = 0.015;
    const verts = [];

    for (let v = 0; v <= labelMax; v += 8) {
      const t = v / labelMax;
      const z = minZ + (maxZ - minZ) * t;
      verts.push(x, y, z, x, y + tickLen, z);
    }
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: true, depthWrite: false });
    this._materials.push(mat);
    group.add(this._linesFromVerts(verts, mat, 'ticksZ'));

    for (let v = 0; v <= labelMax; v += 8) {
      if (v % 16 !== 0) continue;
      const t = v / labelMax;
      const z = minZ + (maxZ - minZ) * t;
      group.add(this._makeLabelSprite(String(v), new THREE.Vector3(x, y + tickLen * 2.2, z), color));
    }
    return group;
  }

  // Yルーラーも要望により撤去

  _makeLabelSprite(text, position, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // white-ish text; color is applied via SpriteMaterial tint
    // HUD寄せ：Inter系 + 小さめ
    ctx.font = '22px "Inter", "Roboto", "Helvetica Neue", "Helvetica", "Arial", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: color,
      transparent: true,
      opacity: 0.9,
      // 数字が床や粒で隠れて「出てない」ように見えるのを避ける
      depthTest: false,
      depthWrite: false
    });
    this._materials.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    const w = this._labelScale;
    sprite.scale.set(w, w * 0.5, 1);
    sprite.renderOrder = 10;
    sprite.frustumCulled = false;
    this._labelSprites.push(sprite);
    return sprite;
  }
}


