/**
 * SimpleParticleSystem (WebGPU)
 * - シンプルなGPGPUパーティクルシステム
 * - カールノイズで動かす
 * - 150万粒程度
 */

import * as THREE from "three/webgpu";
import {
    Fn,
    If,
    instanceIndex,
    Return,
    uniform,
    float,
    vec2,
    vec3,
    vec4,
    uint,
    max,
    clamp,
    mix,
    normalize,
    dot,
    sin,
    cos,
    floor,
    fract,
    abs,
    varying,
    attribute,
    uv,
    pow,
    step,
    cameraWorldMatrix,
    cameraPosition
} from "three/tsl";
import { StructuredArray } from '../../mls-mpm/structuredArray.js';

export class SimpleParticleSystem {
    constructor(renderer) {
        this.renderer = renderer;
        // 約150万粒（緯度経度グリッドが崩れないよう、正方に寄せる）
        // NOTE: 150万ちょうどより「格子が揃う」ことを優先（ズレは僅少）
        this.gridCols = 1225;
        this.gridRows = 1225;
        this.numParticles = this.gridCols * this.gridRows;
        this.particleBuffer = null;
        this.pressureBuffer = null; // 圧力用の別バッファ（通常モードでは作らない）
        this.uniforms = {};
        this.kernels = {};
        this.object = null;
        this._pressureEnabled = false;
        // パフォーマンス調整
        // - FPSが上下に暴れるのを避けるため「computeを丸ごとスキップ」はやらない
        // - 毎フレcomputeは回しつつ、粒子を半分ずつ更新（偶数/奇数）にして負荷を均す
        this.updateStride = 1; // デフォはFULL（要望）
        this._frameIndex = 0;
        // 粒を非表示にした時にcomputeまで回すのは無駄なので、Scene側から切り替えられるようにする
        this.computeEnabled = true;
        
        // レンダリングモード: 'billboard' (デフォルト) または 'mesh'
        this.renderMode = 'billboard';
    }

    async init() {
        // パーティクルバッファの構造を定義
        const particleStruct = {
            position: { type: 'vec3' },
            dir: { type: 'vec3' },   // 緯度経度固定（単位ベクトル）
            heat: { type: 'float' }, // ヒートマップ用（0..1）
        };
        
        this.particleBuffer = new StructuredArray(particleStruct, this.numParticles, "particleData");
        // NOTE:
        // - 150万粒をCPUループで初期化すると重いので、GPU側のcomputeで初期化する
        // - StructuredArray の backing buffer は触らず、computeで確実にGPUへ書く

        // Uniforms
        this.uniforms.time = uniform(0.0);
        this.uniforms.deltaTime = uniform(0.016);
        this.uniforms.numParticles = uniform(this.numParticles, "uint");
        this.uniforms.updateParity = uniform(0, "uint"); // 0/1: 偶数/奇数を更新
        this.uniforms.gridCols = uniform(this.gridCols, "uint");
        this.uniforms.gridRows = uniform(this.gridRows, "uint");
        // sphere mapping + height noise
        this.uniforms.noiseScale = uniform(2.2);     // 空間スケール
        this.uniforms.heightAmp = uniform(0.38);     // 半径変位量（少し強め）
        this.uniforms.noiseSpeed = uniform(0.035);   // 時間スケール（動き）
        // ノイズモード（フラグ式）
        // - sphereMapping: dir固定で「半径だけ」変える（従来）
        // - flowOnSphere: dir自体をノイズで流して「緯度経度も動かす」（球体マッピングじゃない挙動の試験）
        this.uniforms.flowOnSphereEnabled = uniform(0.0);
        this.uniforms.flowOnSphereFreq = uniform(3.0);
        this.uniforms.flowOnSphereStrength = uniform(0.65);
        // 初期球体を小さくする（要望）
        this.uniforms.baseRadius = uniform(1.0);
        // heatmap 調整（赤くなりすぎ防止）
        // NOTE: 要望「もうちょっと赤くなりやすく」→ scale↑ / gamma↓
        // NOTE:
        // まだ青/緑止まり＝「外側に出る量」が小さく heat が中域に固まりがち（環境依存の可能性あり）。
        // ここは意図的に強めて“赤まで届く”ようにする。
        // ヒートマップ調整（色の飽和を避けて中間色を出す）
        // - scale を上げすぎると t が飽和して「青/赤だけ」になりやすい
        this.uniforms.heatScale = uniform(1.0);
        this.uniforms.heatGamma = uniform(1.15);

        // Track5: 内側からの圧力（イベント時に1回だけapplyPressureカーネルで焼き込む）
        this.uniforms.pressureModeEnabled = uniform(0.0); // 0:OFF(軽量) / 1:ON
        this.uniforms.pressureDir = uniform(new THREE.Vector3(0, 1, 0));
        this.uniforms.pressureStrength = uniform(0.0);
        this.uniforms.pressureAngle = uniform(0.45);        // rad（影響範囲）
        this.uniforms.pressureHeatGain = uniform(1.4);      // 圧力→heat寄与
        this.uniforms.pressureNoiseFreq = uniform(9.0);     // 山のザラつき周波数
        this.uniforms.pressureNoiseAmp = uniform(0.55);     // ザラつき強度（0..1）
        this.uniforms.pressureOffsetMax = uniform(0.65);    // offset上限（暴走防止）
        this.uniforms.pressureVelDamping = uniform(3.5);    // 速度減衰（1/sec）: 大きいほどすぐ落ち着く
        this.uniforms.pressureVelMax = uniform(0.9);        // 速度上限（暴走防止）

        // 3D value noise (sinなし) で周期/対称を崩す
        const hash31 = Fn(([p]) => {
            // IQ系のsin無しhash（0..1）
            const q = fract(p.mul(vec3(0.1031, 0.11369, 0.13787))).toVar();
            const d = dot(q, q.yzx.add(33.33));
            q.addAssign(d);
            return fract((q.x.add(q.y)).mul(q.z));
        });

        const noise3 = Fn(([p]) => {
            const i = floor(p);
            const f = fract(p);
            const u = f.mul(f).mul(vec3(3.0).sub(f.mul(2.0)));

            const n000 = hash31(i.add(vec3(0, 0, 0)));
            const n100 = hash31(i.add(vec3(1, 0, 0)));
            const n010 = hash31(i.add(vec3(0, 1, 0)));
            const n110 = hash31(i.add(vec3(1, 1, 0)));
            const n001 = hash31(i.add(vec3(0, 0, 1)));
            const n101 = hash31(i.add(vec3(1, 0, 1)));
            const n011 = hash31(i.add(vec3(0, 1, 1)));
            const n111 = hash31(i.add(vec3(1, 1, 1)));

            const nx00 = mix(n000, n100, u.x);
            const nx10 = mix(n010, n110, u.x);
            const nx01 = mix(n001, n101, u.x);
            const nx11 = mix(n011, n111, u.x);
            const nxy0 = mix(nx00, nx10, u.y);
            const nxy1 = mix(nx01, nx11, u.y);
            return mix(nxy0, nxy1, u.z);
        });

        const heightNoise = Fn(([dir, t]) => {
            // 軸ごとに時間の係数を変えて対称性を崩す
            const tt = t.mul(this.uniforms.noiseSpeed);
            const timeOffset = vec3(tt.mul(0.73), tt.mul(1.11), tt.mul(1.77));
            const p = dir.mul(this.uniforms.noiseScale).add(timeOffset);
            // 2オクターブ（周期感をさらに崩す）
            const n0 = noise3(p);
            const n1 = noise3(p.mul(2.13).add(vec3(7.13, 2.17, 1.31))).mul(0.5);
            return n0.add(n1).div(1.5);
        });

        // 後から圧力モードをONにした時に使うので保持しておく
        this._noise3Fn = noise3;
        this._heightNoiseFn = heightNoise;

        // ===== Reset particles (GPU) =====
        this.kernels.resetParticles = Fn(() => {
            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });

            // 緯度経度（rows/cols）に固定して球面へ配置
            const cols = float(this.uniforms.gridCols).toConst('cols');
            const rows = float(this.uniforms.gridRows).toConst('rows');
            const id = float(instanceIndex).toConst('id');
            const iy = floor(id.div(cols)).toConst('iy');
            const ix = id.sub(iy.mul(cols)).toConst('ix');
            const u = ix.div(max(float(1.0), cols.sub(1.0))).toConst('u');
            const v = iy.div(max(float(1.0), rows.sub(1.0))).toConst('v');

            const twoPi = float(6.28318530718);
            const pi = float(3.14159265359);
            const halfPi = float(1.57079632679);
            const lon = u.mul(twoPi).toConst('lon');
            const lat = v.mul(pi).sub(halfPi).toConst('lat'); // -pi/2..pi/2

            const clat = cos(lat).toConst('clat');
            const dir = vec3(
                clat.mul(cos(lon)),
                sin(lat),
                clat.mul(sin(lon))
            ).toConst('dir');

            const particle = this.particleBuffer.element(instanceIndex);
            particle.get('dir').assign(dir);
            particle.get('position').assign(dir.mul(this.uniforms.baseRadius));
            particle.get('heat').assign(0.0);
        })().compute(1);

        // パーティクル更新カーネル（半分更新）
        this.kernels.updateHalf = Fn(() => {
            // 半分更新: idx = instanceIndex*2 + parity
            const idx = instanceIndex.mul(uint(2)).add(uint(this.uniforms.updateParity)).toConst('idx');
            If(idx.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });

            const particle = this.particleBuffer.element(idx);
            const dirVar = particle.get('dir').xyz.toVar('dirVar');

            // flowOnSphere: dirをノイズで流す（緯度経度固定を崩す）
            If(this.uniforms.flowOnSphereEnabled.greaterThanEqual(float(0.5)), () => {
                const tt = this.uniforms.time.mul(0.15).toConst('ftt');
                const toff = vec3(tt.mul(0.73), tt.mul(1.11), tt.mul(1.77)).toConst('ftoff');
                const p = dirVar.mul(this.uniforms.flowOnSphereFreq).add(toff).toConst('fp');
                const nA = noise3(p).toConst('nA');
                const nB = noise3(p.yzx.add(vec3(11.2, 3.4, 7.7))).toConst('nB');
                const nC = noise3(p.zxy.add(vec3(5.1, 9.2, 1.3))).toConst('nC');
                const v0 = vec3(nA, nB, nC).sub(vec3(0.5, 0.5, 0.5)).toConst('fv0');
                const vt = v0.sub(dirVar.mul(dot(v0, dirVar))).toConst('fvt'); // tangent
                const dirNew = normalize(dirVar.add(vt.mul(this.uniforms.flowOnSphereStrength).mul(this.uniforms.deltaTime))).toConst('dirNew');
                dirVar.assign(dirNew);
                particle.get('dir').assign(dirNew);
            });
            const dir = dirVar.toConst('pDir');

            const n0 = heightNoise(dir, this.uniforms.time).toConst('n0');

            // 高さ（中心は0付近へ）
            const h01 = n0.sub(0.5).toConst('h01'); // -0.5..+0.5 付近
            const h = h01.mul(this.uniforms.heightAmp).toConst('h');
            const radius = this.uniforms.baseRadius.add(h).toConst('radius');
            const position = dir.mul(radius).toConst('pos');

            // ヒートマップ:
            // - 「元の球体（baseRadius）」= 0（青）
            // - 球面から外側へ（半径が増える）ほど 1（赤）
            // n0-0.5 の正側だけを 0..1 に正規化（*2 で [0..0.5]→[0..1]）
            // NOTE: ここは“素のheat(0..1)”を保存して、色側でガンマ/ブーストを調整する
            // heatは“一箇所（compute）”で決める（圧力もヒートに反映）
            const heatBase = max(float(0.0), h01).mul(2.0).toConst('heatBase');
            const heat = clamp(heatBase, 0.0, 1.0).toConst('heat');

            particle.get('position').assign(position);
            particle.get('heat').assign(heat);
        })().compute(1);

        // パーティクル更新カーネル（フル更新）
        this.kernels.updateFull = Fn(() => {
            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });

            const particle = this.particleBuffer.element(instanceIndex);
            const dirVar = particle.get('dir').xyz.toVar('dirVarF');

            // flowOnSphere: dirをノイズで流す（緯度経度固定を崩す）
            If(this.uniforms.flowOnSphereEnabled.greaterThanEqual(float(0.5)), () => {
                const tt = this.uniforms.time.mul(0.15).toConst('fttF');
                const toff = vec3(tt.mul(0.73), tt.mul(1.11), tt.mul(1.77)).toConst('ftoffF');
                const p = dirVar.mul(this.uniforms.flowOnSphereFreq).add(toff).toConst('fpF');
                const nA = noise3(p).toConst('nAF');
                const nB = noise3(p.yzx.add(vec3(11.2, 3.4, 7.7))).toConst('nBF');
                const nC = noise3(p.zxy.add(vec3(5.1, 9.2, 1.3))).toConst('nCF');
                const v0 = vec3(nA, nB, nC).sub(vec3(0.5, 0.5, 0.5)).toConst('fv0F');
                const vt = v0.sub(dirVar.mul(dot(v0, dirVar))).toConst('fvtF'); // tangent
                const dirNew = normalize(dirVar.add(vt.mul(this.uniforms.flowOnSphereStrength).mul(this.uniforms.deltaTime))).toConst('dirNewF');
                dirVar.assign(dirNew);
                particle.get('dir').assign(dirNew);
            });
            const dir = dirVar.toConst('pDirF');

            const n0 = heightNoise(dir, this.uniforms.time).toConst('n0');
            const h01 = n0.sub(0.5).toConst('h01');
            const h = h01.mul(this.uniforms.heightAmp).toConst('h');
            const radius = this.uniforms.baseRadius.add(h).toConst('radius');
            const position = dir.mul(radius).toConst('pos');

            const heatBase = max(float(0.0), h01).mul(2.0).toConst('heatBase');
            const heat = clamp(heatBase, 0.0, 1.0).toConst('heat');

            particle.get('position').assign(position);
            particle.get('heat').assign(heat);
        })().compute(1);

        // dispatch count を設定（MLS-MPMと同じ流儀）
        this.kernels.resetParticles.count = this.numParticles;
        this.kernels.resetParticles.updateDispatchCount();
        // update dispatch（フル/半分 両対応）
        this.kernels.updateHalf.count = Math.ceil(this.numParticles / 2);
        this.kernels.updateHalf.updateDispatchCount();
        this.kernels.updateFull.count = this.numParticles;
        this.kernels.updateFull.updateDispatchCount();

        // GPUで初期化を実行
        await this.renderer.computeAsync([this.kernels.resetParticles]);

        // 描画オブジェクトを作成
        this.createRenderObject();
    }

    createRenderObject() {
        // NOTE:
        // WebGPUのPointsはpoint sprite（gl_PointCoord / サイズ指定）が使えない制約があるため、
        // 疑似sphereは「ビルボードquad」をinstancingして実現する。
        // 150万粒 = 150万quad = 300万tri（4頂点×instance）なので、サイズ/overdrawは小さく保つ。

        const base = new THREE.PlaneGeometry(1, 1, 1, 1);
        const geometry = new THREE.InstancedBufferGeometry().copy(base);
        geometry.instanceCount = this.numParticles;

        const material = new THREE.MeshBasicNodeMaterial();
        material.transparent = false;
        material.depthWrite = true;
        // 表面がスカスカに見えて「内側が見える」ので、円盤の実効面積を増やす
        material.alphaTest = 0.35;
        // 念のためブレンドなし（"透けてる？"の誤解を潰す）
        material.blending = THREE.NoBlending;

        const particle = this.particleBuffer.element(instanceIndex);

        // Billboard（world space）
        // cameraWorldMatrix * vec4(axis,0) で right/up を取り出す
        const camRight = cameraWorldMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz.toConst('camRight');
        const camUp = cameraWorldMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz.toConst('camUp');

        // もっと小さく（ユーザー要望）
        const size = float(0.005).toConst('billboardSize');
        const corner = attribute('position').xy.toConst('corner'); // -0.5..0.5（PlaneGeometry）

        // varying（vertex→fragment）
        // NOTE: 他の実装（mls-mpm/particleRenderer）に合わせて「0/vec3(0)」で宣言
        const vHeat = varying(0, 'vHeat');
        const vPos = varying(vec3(0), 'vPos');

        // 疑似sphere + 疑似ライティング（fragment）
        // uv: 0..1 のquad座標から球法線を復元
        const u = uv().toConst('u0');
        const c = u.sub(vec2(0.5)).mul(2.0).toConst('c2'); // -1..1
        const r2 = dot(c, c).toConst('r2'); // 0..2
        const inside = float(1.0).sub(step(float(1.0), r2)).toConst('inside'); // r2<1 → 1
        const z = pow(max(float(0.0), float(1.0).sub(r2)), float(0.5)).toConst('z'); // sqrt(1-r2)
        // NOTE: (c.x,c.y,z) は理論上すでに長さ1なので normalize を省いて軽量化
        const nLocal = vec3(c.x, c.y, z).toConst('nLocal');

        // varyingはvertex側で代入
        material.positionNode = Fn(() => {
            const p = particle.get('position').toConst('p');
            vHeat.assign(particle.get('heat'));
            vPos.assign(p);
            const offset = camRight.mul(corner.x).add(camUp.mul(corner.y)).mul(size);
            return p.add(offset);
        })();

        const heat = vHeat.toConst('heat');
        // 0..1 を色へ（中間色をちゃんと出すためのレンジ圧縮 + smoothstep）
        // NOTE: ここで飽和させすぎると「青/赤だけ」になりがち
        const h = heat.clamp(0.0, 1.0).toConst('h');
        const tn = clamp(h.sub(0.03).div(0.75), 0.0, 1.0).toConst('tn'); // 低域を少し捨てて中域を厚く
        const tSmooth = tn.mul(tn).mul(float(3.0).sub(tn.mul(2.0))).toConst('tSmooth');
        const t = clamp(pow(tSmooth, this.uniforms.heatGamma).mul(this.uniforms.heatScale), 0.0, 1.0).toConst('tHeat');

        // 連続jet（段階stepを捨てる：0だけ青、他が緑に潰れる問題を避ける）
        // r = clamp(1.5 - |4t - 3|), g = clamp(1.5 - |4t - 2|), b = clamp(1.5 - |4t - 1|)
        const tt4 = t.mul(4.0).toConst('tt4');
        const r = clamp(float(1.5).sub(abs(tt4.sub(3.0))), 0.0, 1.0).toConst('rJet');
        const g = clamp(float(1.5).sub(abs(tt4.sub(2.0))), 0.0, 1.0).toConst('gJet');
        const b = clamp(float(1.5).sub(abs(tt4.sub(1.0))), 0.0, 1.0).toConst('bJet');
        const heatColor = vec3(r, g, b).toConst('heatColor');

        // 疑似ライティング（超軽量版）
        // - カメラ基準のライト（ビュー空間固定）にして、world変換/normalize/cameraPosition計算を削る
        // - "それっぽさ"は diffuse + うっすらspec + rim で出す
        const albedo = heatColor.toConst('albedo');
        const L = normalize(vec3(-0.35, 0.65, 0.70)).toConst('Lview');
        const ndotl = max(dot(nLocal, L), float(0.0)).toConst('ndotl');
        const diffuse = albedo.mul(mix(float(0.22), float(1.0), ndotl)).toConst('diffuse');
        const H = normalize(L.add(vec3(0.0, 0.0, 1.0))).toConst('Hview');
        const ndoth = max(dot(nLocal, H), float(0.0)).toConst('ndoth');
        const spec = pow(ndoth, float(24.0)).mul(0.08).toConst('spec');
        const rim = pow(float(1.0).sub(z), float(2.2)).mul(0.10).toConst('rim');
        const lit = diffuse.add(albedo.mul(spec)).add(vec3(rim)).clamp(0.0, 1.0).toConst('lit');

        material.colorNode = lit;
        material.opacityNode = inside;

        this.object = new THREE.Mesh(geometry, material);
        this.object.frustumCulled = false;
    }

    _ensurePressureResources() {
        if (this.pressureBuffer) return;
        if (!this._noise3Fn || !this._heightNoiseFn) return;

        const noise3 = this._noise3Fn;
        const heightNoise = this._heightNoiseFn;

        const pressureStruct = {
            offset: { type: 'float' },
            offsetVel: { type: 'float' },
        };
        this.pressureBuffer = new StructuredArray(pressureStruct, this.numParticles, "particlePressure");

        // pressureBuffer 初期化
        this.kernels.resetPressure = Fn(() => {
            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });
            const pr = this.pressureBuffer.element(instanceIndex);
            pr.get('offset').assign(0.0);
            pr.get('offsetVel').assign(0.0);
        })().compute(1);

        // Track5: 圧力インパルス（速度へ）
        this.kernels.applyPressure = Fn(() => {
            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });

            const particle = this.particleBuffer.element(instanceIndex);
            const pr = this.pressureBuffer.element(instanceIndex);
            const dir = particle.get('dir').xyz.toConst('pDir');

            const pDir = normalize(this.uniforms.pressureDir).toConst('pDirU');
            const d = dot(dir, pDir).toConst('pDot'); // cos(angle)
            const ang = this.uniforms.pressureAngle.toConst('pAng');

            // 山（中心最大→外へなだらか）: dome
            const outer = cos(ang).toConst('pOuter');
            const w0 = clamp(d.sub(outer).div(max(float(1e-4), float(1.0).sub(outer))), 0.0, 1.0).toConst('pW0');
            const smooth = w0.mul(w0).mul(float(3.0).sub(w0.mul(2.0))).toConst('pSmooth');
            const dome = pow(smooth, float(2.2)).toConst('pDome');

            // ノイズ（形は固定：時間で戻らないようにする）
            const pn = noise3(dir.mul(this.uniforms.pressureNoiseFreq).add(pDir.mul(7.13))).toConst('pN');
            const nMul = mix(float(1.0).sub(this.uniforms.pressureNoiseAmp), float(1.0).add(this.uniforms.pressureNoiseAmp), pn).toConst('pNMul');

            // 速度へインパルス
            const impulse = dome.mul(nMul).mul(this.uniforms.pressureStrength).toConst('pImpulse');
            const v0 = pr.get('offsetVel').toConst('v0');
            const v1 = clamp(v0.add(impulse), float(0.0), this.uniforms.pressureVelMax).toConst('v1');
            pr.get('offsetVel').assign(v1);
        })().compute(1);

        // 圧力モード用 update（offset/vel を積分して半径へ）
        this.kernels.updatePressure = Fn(() => {
            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });

            const particle = this.particleBuffer.element(instanceIndex);
            const pr = this.pressureBuffer.element(instanceIndex);
            const dir = particle.get('dir').xyz.toConst('pDir');

            const n0 = heightNoise(dir, this.uniforms.time).toConst('n0');
            const h01 = n0.sub(0.5).toConst('h01');
            const h = h01.mul(this.uniforms.heightAmp).toConst('h');

            const off0 = pr.get('offset').toConst('off0');
            const v0 = pr.get('offsetVel').toConst('v0u');
            const dt = max(float(0.0), this.uniforms.deltaTime).toConst('dt');
            const damp = this.uniforms.pressureVelDamping.toConst('damp');
            const vD = v0.div(float(1.0).add(damp.mul(dt))).toConst('vD'); // 近似指数減衰
            const off1 = clamp(off0.add(vD.mul(dt)), 0.0, this.uniforms.pressureOffsetMax).toConst('off1');
            pr.get('offsetVel').assign(vD);
            pr.get('offset').assign(off1);

            const radius = this.uniforms.baseRadius.add(h).add(off1).toConst('radius');
            const position = dir.mul(radius).toConst('pos');

            const heatBase = max(float(0.0), h01).mul(2.0).toConst('heatBase');
            const heatPress = off1.mul(this.uniforms.pressureHeatGain).toConst('heatPress');
            const heat = clamp(heatBase.add(heatPress), 0.0, 1.0).toConst('heat');

            particle.get('position').assign(position);
            particle.get('heat').assign(heat);
        })().compute(1);

        // dispatch count を設定
        this.kernels.resetPressure.count = this.numParticles;
        this.kernels.resetPressure.updateDispatchCount();
        this.kernels.applyPressure.count = this.numParticles;
        this.kernels.applyPressure.updateDispatchCount();
        this.kernels.updatePressure.count = this.numParticles;
        this.kernels.updatePressure.updateDispatchCount();
    }

    update(delta, elapsed) {
        this.uniforms.time.value = elapsed;
        this._frameIndex++;
        const stride = Math.max(1, this.updateStride | 0);
        const useHalf = stride >= 2;
        // 半分更新でも“速度感”を揃えるため dt をstride倍にする
        this.uniforms.deltaTime.value = delta * (useHalf ? 2 : 1);
        this.uniforms.updateParity.value = (this._frameIndex & 1) ? 1 : 0;

        // 粒が非表示のときはuniform更新だけしてcomputeは止める
        if (!this.computeEnabled) return;

        // computeは「1本だけin-flight」にして、毎フレawaitで詰まるのを避ける
        if (this._computeInFlight) return;
        this._computeInFlight = true;

        const kernels = [];
        if (this._needsReset && this.kernels.resetParticles) {
            this._needsReset = false;
            kernels.push(this.kernels.resetParticles);
            if (this.pressureBuffer && this.kernels.resetPressure) {
                kernels.push(this.kernels.resetPressure);
            }
        }
        if (this._needsPressureInit && this.kernels.resetPressure) {
            this._needsPressureInit = false;
            kernels.push(this.kernels.resetPressure);
        }
        if (this._needsPressure && this.kernels.applyPressure) {
            this._needsPressure = false;
            if (this._pressureEnabled) {
                kernels.push(this.kernels.applyPressure);
            }
        }
        if (this._pressureEnabled && this.kernels.updatePressure) {
            kernels.push(this.kernels.updatePressure);
        } else if (useHalf && this.kernels.updateHalf) {
            kernels.push(this.kernels.updateHalf);
        } else if (this.kernels.updateFull) {
            kernels.push(this.kernels.updateFull);
        }

        if (!kernels.length) {
            this._computeInFlight = false;
            return;
        }

        this.renderer.computeAsync(kernels).finally(() => {
            this._computeInFlight = false;
        });
    }

    reset() {
        // resetはGPUでやる（CPUループは重い）
        // NOTE: Scene側から呼ばれる想定なので、asyncにせずフラグだけ立てる
        this._needsReset = true;
    }

    /**
     * Track5: 圧力を永続オフセットとして焼き込む
     * @param {{x:number,y:number,z:number}} dir
     * @param {number} strength
     * @param {number} angle
     */
    applyPressure(dir, strength, angle) {
        if (!this.uniforms) return;
        // 圧力モードがONの時だけ動かす（通常モードを軽く保つ）
        if (!this._pressureEnabled) return;
        this._ensurePressureResources();
        if (this.uniforms.pressureModeEnabled) this.uniforms.pressureModeEnabled.value = 1.0;
        if (this.uniforms.pressureDir?.value?.set) this.uniforms.pressureDir.value.set(dir.x, dir.y, dir.z);
        if (this.uniforms.pressureStrength) this.uniforms.pressureStrength.value = Number(strength) || 0;
        if (this.uniforms.pressureAngle) this.uniforms.pressureAngle.value = Number(angle) || 0.45;
        this._needsPressure = true;
    }

    setPressureModeEnabled(enabled) {
        if (!this.uniforms?.pressureModeEnabled) return;
        this._pressureEnabled = !!enabled;
        this.uniforms.pressureModeEnabled.value = this._pressureEnabled ? 1.0 : 0.0;
        if (this._pressureEnabled) {
            this._ensurePressureResources();
            this._needsPressureInit = true; // 初回だけpressureBufferを0初期化
        }
    }

    /**
     * Track5用: 圧力パラメータをまとめて反映（任意）
     */
    setPressureTuning({ velMax, velDamping, offsetMax, pressureHeatGain } = {}) {
        if (!this.uniforms) return;
        if (typeof velMax === 'number' && this.uniforms.pressureVelMax) {
            this.uniforms.pressureVelMax.value = velMax;
        }
        if (typeof velDamping === 'number' && this.uniforms.pressureVelDamping) {
            this.uniforms.pressureVelDamping.value = velDamping;
        }
        if (typeof offsetMax === 'number' && this.uniforms.pressureOffsetMax) {
            this.uniforms.pressureOffsetMax.value = offsetMax;
        }
        if (typeof pressureHeatGain === 'number' && this.uniforms.pressureHeatGain) {
            this.uniforms.pressureHeatGain.value = pressureHeatGain;
        }
    }
}

