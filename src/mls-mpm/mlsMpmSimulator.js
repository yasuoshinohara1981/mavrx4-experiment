import * as THREE from "three/webgpu";
import {
    array,
    Fn,
    If,
    instancedArray,
    instanceIndex,
    Return,
    uniform,
    int,
    float,
    Loop,
    vec3,
    vec4,
    atomicAdd,
    uint,
    max,
    pow,
    mat3,
    clamp,
    time,
    cross, mix, mx_hsvtorgb, select, ivec3, fract, sin, abs
} from "three/tsl";
import {triNoise3Dvec} from "../common/noise.js";
import {conf} from "../common/conf.js";
import {StructuredArray} from "./structuredArray.js";
import {hsvtorgb} from "../common/hsv.js";

class mlsMpmSimulator {
    renderer = null;
    numParticles = 0;
    gridSize = new THREE.Vector3(0,0,0);
    gridCellSize = new THREE.Vector3(0,0,0);
    uniforms = {};
    kernels = {};
    fixedPointMultiplier = 1e7;
    // マウス追従は使わない（互換のためuniformだけ残す）
    mousePos = new THREE.Vector3();
    mousePosArray = [];

    // Track5 impulse（ポリフォニック：複数同時に残す）
    // NOTE:
    // - 1個分のuniformを上書きしてたせいで「前のデュレーションが残ってると次が来た瞬間に消える」問題が起きてた
    // - maxImpulses個まで同時保持し、GPU側で全部ループ適用する
    maxImpulses = 8;
    impulses = [];
    // 前回の力の中心位置（scene08互換：ロール時の連続性のため）
    lastForceCenter = null;

    maxParticles = 0;
    
    // シーン要望：Track5（impulse）以外では動かさない
    // NOTE:
    // - 「完全停止」ではなく「外力（重力/ノイズ）を止める」だけにする
    // - impulseが終わった後も、慣性＋粘性で自然に減衰するため update を止めない
    freezeWhenNoImpulse = false;
    onlyImpulseMotion = true;

    constructor(renderer) {
        this.renderer = renderer;
    }
    async init() {
        const {maxParticles} = conf;
        this.maxParticles = maxParticles;
        this.gridSize.set(64,64,64);

        const particleStruct =  {
            position: { type: 'vec3' },
            density: { type: 'float' },
            velocity: { type: 'vec3' },
            mass: { type: 'float' },
            C: { type: 'mat3' },
            direction: { type: 'vec3' },
            color: { type: 'vec3' },
        };
        this.particleBuffer = new StructuredArray(particleStruct, maxParticles, "particleData");

        const vec = new THREE.Vector3();
        for (let i = 0; i < maxParticles; i++) {
            let dist = 2;
            while (dist > 1) {
                vec.set(Math.random(),Math.random(),Math.random()).multiplyScalar(2.0).subScalar(1.0);
                dist = vec.length();
                // 初期配置を箱の壁際まで寄せる（サンプル由来の0.8制限を緩める）
                // NOTE: 境界の数セル分はMLS-MPMの近傍参照の都合で必要なので、完全に0..64へは寄せない
                vec.multiplyScalar(0.95).addScalar(1.0).divideScalar(2.0).multiply(this.gridSize);
            }
            const mass = 1.0 - Math.random() * 0.002;
            this.particleBuffer.set(i, "position", vec);
            this.particleBuffer.set(i, "mass", mass);

            // === 初期値（可視化が成立するように明示） ===
            // - colorが未初期化(=0,0,0)だと黒背景＋マット材で「見えない」になる
            // - directionがゼロだとlookAt行列が壊れてNaNになり得る
            this.particleBuffer.set(i, "velocity", [0, 0, 0]);
            this.particleBuffer.set(i, "density", 1.0);
            this.particleBuffer.set(i, "direction", [0, 0, 1]);
            this.particleBuffer.set(i, "color", [0.05, 0.35, 1.0]); // デフォルトは青寄り（ヒートマップの「無=青」）
        }

        // NOTE:
        // particleBuffer は StructuredArray が TypedArray を渡して生成している。
        // ここで buffer.value を触ると WebGPU backend 側で attribute.array が壊れて落ちることがあるため触らない。
        // ただし「CPU側で埋めた初期値がGPUに反映されない」ケースがあるので needsUpdate だけは立てる。
        if (this.particleBuffer?.buffer) {
            this.particleBuffer.buffer.needsUpdate = true;
        }

        const cellCount = this.gridSize.x * this.gridSize.y * this.gridSize.z;
        const cellStruct ={
            x: { type: 'int', atomic: true },
            y: { type: 'int', atomic: true },
            z: { type: 'int', atomic: true },
            mass: { type: 'int', atomic: true },
        };
        this.cellBuffer = new StructuredArray(cellStruct, cellCount, "cellData");
        // WebGPUでは「サイズだけのinstancedArray」だと backing array が無くて落ちることがあるので、
        // 明示的にTypedArrayを渡して確保する。
        this.cellBufferF = instancedArray(new Float32Array(cellCount * 4), 'vec4').label('cellDataF');
        if (this.cellBuffer?.buffer) this.cellBuffer.buffer.needsUpdate = true;
        if (this.cellBufferF) this.cellBufferF.needsUpdate = true;

        this.uniforms.gravityType = uniform(0, "uint");
        this.uniforms.gravity = uniform(new THREE.Vector3());
        this.uniforms.stiffness = uniform(0);
        this.uniforms.restDensity = uniform(0);
        this.uniforms.dynamicViscosity = uniform(0);
        this.uniforms.noise = uniform(0);

        this.uniforms.gridSize = uniform(this.gridSize, "ivec3");
        this.uniforms.gridCellSize = uniform(this.gridCellSize);
        this.uniforms.dt = uniform(0.1);
        this.uniforms.numParticles = uniform(0, "uint");

        // 初期パーティクル数を設定
        this.numParticles = conf.particles;
        this.uniforms.numParticles.value = conf.particles;

        this.uniforms.mouseRayDirection = uniform(new THREE.Vector3());
        this.uniforms.mouseRayOrigin = uniform(new THREE.Vector3());
        this.uniforms.mouseForce = uniform(new THREE.Vector3());

        // ヒートマップ（速度→色）レンジ
        this.uniforms.heatSpeedMin = uniform(0.002);
        this.uniforms.heatSpeedMax = uniform(0.05);

        // Track5 impulse uniforms（固定長：pos/radius と strength をスロットで持つ）
        // - impulsePR[i] = vec4(pos.xyz, radius)
        // - impulseS[i]  = vec4(strength, 0,0,0)
        for (let i = 0; i < this.maxImpulses; i++) {
            this.uniforms[`impulsePR${i}`] = uniform(new THREE.Vector4(0, 0, 0, 1.0));
            this.uniforms[`impulseS${i}`] = uniform(new THREE.Vector4(0, 0, 0, 0));
        }
        this.impulses = new Array(this.maxImpulses).fill(null);

        this.kernels.clearGrid = Fn(() => {
            this.cellBuffer.setAtomic("x", false);
            this.cellBuffer.setAtomic("y", false);
            this.cellBuffer.setAtomic("z", false);
            this.cellBuffer.setAtomic("mass", false);

            If(instanceIndex.greaterThanEqual(uint(cellCount)), () => {
                Return();
            });

            this.cellBuffer.element(instanceIndex).get('x').assign(0);
            this.cellBuffer.element(instanceIndex).get('y').assign(0);
            this.cellBuffer.element(instanceIndex).get('z').assign(0);
            this.cellBuffer.element(instanceIndex).get('mass').assign(0);
            this.cellBufferF.element(instanceIndex).assign(0);
        })().compute(cellCount);

        const encodeFixedPoint = (f32) => {
            return int(f32.mul(this.fixedPointMultiplier));
        }
        const decodeFixedPoint = (i32) => {
            return float(i32).div(this.fixedPointMultiplier);
        }

        const getCellPtr = (ipos) => {
            const gridSize = this.uniforms.gridSize;
            const cellPtr = int(ipos.x).mul(gridSize.y).mul(gridSize.z).add(int(ipos.y).mul(gridSize.z)).add(int(ipos.z)).toConst();
            return cellPtr;
        };
        const getCell = (ipos) => {
            return this.cellBuffer.element(getCellPtr(ipos));
        };

        this.kernels.p2g1 = Fn(() => {
            this.cellBuffer.setAtomic("x", true);
            this.cellBuffer.setAtomic("y", true);
            this.cellBuffer.setAtomic("z", true);
            this.cellBuffer.setAtomic("mass", true);

            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });
            const particlePosition = this.particleBuffer.element(instanceIndex).get('position').xyz.toConst("particlePosition");
            const particleVelocity = this.particleBuffer.element(instanceIndex).get('velocity').xyz.toConst("particleVelocity");

            const cellIndex =  ivec3(particlePosition).sub(1).toConst("cellIndex");
            const cellDiff = particlePosition.fract().sub(0.5).toConst("cellDiff");
            const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
            const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
            const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
            const weights = array([w0,w1,w2]).toConst("weights");

            const C = this.particleBuffer.element(instanceIndex).get('C').toConst();
            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({gx}) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({gy}) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({gz}) => {
                        const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
                        const cellX = cellIndex.add(ivec3(gx,gy,gz)).toConst();
                        const cellDist = vec3(cellX).add(0.5).sub(particlePosition).toConst("cellDist");
                        const Q = C.mul(cellDist);

                        const massContrib = weight; // assuming particle mass = 1.0
                        const velContrib = massContrib.mul(particleVelocity.add(Q)).toConst("velContrib");
                        const cell = getCell(cellX);
                        atomicAdd(cell.get('x'), encodeFixedPoint(velContrib.x));
                        atomicAdd(cell.get('y'), encodeFixedPoint(velContrib.y));
                        atomicAdd(cell.get('z'), encodeFixedPoint(velContrib.z));
                        atomicAdd(cell.get('mass'), encodeFixedPoint(massContrib));
                    });
                });
            });
        })().compute(1);


        this.kernels.p2g2 = Fn(() => {
            this.cellBuffer.setAtomic("x", true);
            this.cellBuffer.setAtomic("y", true);
            this.cellBuffer.setAtomic("z", true);
            this.cellBuffer.setAtomic("mass", false);

            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });
            const particlePosition = this.particleBuffer.element(instanceIndex).get('position').xyz.toConst("particlePosition");

            const cellIndex =  ivec3(particlePosition).sub(1).toConst("cellIndex");
            const cellDiff = particlePosition.fract().sub(0.5).toConst("cellDiff");
            const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
            const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
            const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
            const weights = array([w0,w1,w2]).toConst("weights");

            const density = float(0).toVar("density");
            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({gx}) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({gy}) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({gz}) => {
                        const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
                        const cellX = cellIndex.add(ivec3(gx,gy,gz)).toConst();
                        const cell = getCell(cellX);
                        density.addAssign(decodeFixedPoint(cell.get('mass')).mul(weight));
                    });
                });
            });
            const densityStore = this.particleBuffer.element(instanceIndex).get('density');
            densityStore.assign(mix(densityStore, density, 0.05));

            // 密度が0の場合は圧力計算をスキップ（粒子が存在しない場合）
            const densitySafe = density.max(0.0001).toConst("densitySafe");
            const volume = float(1).div(densitySafe);
            const pressure = max(0.0, pow(density.div(this.uniforms.restDensity), 5.0).sub(1).mul(this.uniforms.stiffness)).toConst('pressure');
            const stress = mat3(pressure.negate(), 0, 0, 0, pressure.negate(), 0, 0, 0, pressure.negate()).toVar('stress');
            const dudv = this.particleBuffer.element(instanceIndex).get('C').toConst('C');

            const strain = dudv.add(dudv.transpose());
            stress.addAssign(strain.mul(this.uniforms.dynamicViscosity));
            // 密度が0の場合はmomentumを追加しない（粒子が存在しない場合）
            const eq16Term0 = volume.mul(-4).mul(stress).mul(this.uniforms.dt).mul(select(density.greaterThan(0.0001), float(1.0), float(0.0)));

            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({gx}) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({gy}) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({gz}) => {
                        const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
                        const cellX = cellIndex.add(ivec3(gx,gy,gz)).toConst();
                        const cellDist = vec3(cellX).add(0.5).sub(particlePosition).toConst("cellDist");
                        const cell= getCell(cellX);

                        const momentum = eq16Term0.mul(weight).mul(cellDist).toConst("momentum");
                        atomicAdd(cell.get('x'), encodeFixedPoint(momentum.x));
                        atomicAdd(cell.get('y'), encodeFixedPoint(momentum.y));
                        atomicAdd(cell.get('z'), encodeFixedPoint(momentum.z));
                    });
                });
            });
        })().compute(1);


        this.kernels.updateGrid = Fn(() => {
            this.cellBuffer.setAtomic("x", false);
            this.cellBuffer.setAtomic("y", false);
            this.cellBuffer.setAtomic("z", false);
            this.cellBuffer.setAtomic("mass", false);

            If(instanceIndex.greaterThanEqual(uint(cellCount)), () => {
                Return();
            });
            const cell = this.cellBuffer.element(instanceIndex).toConst("cell");

            const mass = decodeFixedPoint(cell.get('mass')).toConst();
            If(mass.lessThanEqual(0), () => { Return(); });

            const vx = decodeFixedPoint(cell.get('x')).div(mass).toVar();
            const vy = decodeFixedPoint(cell.get('y')).div(mass).toVar();
            const vz = decodeFixedPoint(cell.get('z')).div(mass).toVar();

            const x = int(instanceIndex).div(this.uniforms.gridSize.z).div(this.uniforms.gridSize.y);
            const y = int(instanceIndex).div(this.uniforms.gridSize.z).mod(this.uniforms.gridSize.y);
            const z = int(instanceIndex).mod(this.uniforms.gridSize.z);


            // 境界セル（サンプルの2セル厚→1セル厚に緩和）
            // - min側: 0 は壁（x < 1）
            // - max側: 63 は壁（x > 62）
            If(x.lessThan(int(1)).or(x.greaterThan(this.uniforms.gridSize.x.sub(int(2)))), () => {
                vx.assign(0);
            });
            If(y.lessThan(int(1)).or(y.greaterThan(this.uniforms.gridSize.y.sub(int(2)))), () => {
                vy.assign(0);
            });
            If(z.lessThan(int(1)).or(z.greaterThan(this.uniforms.gridSize.z.sub(int(2)))), () => {
                vz.assign(0);
            });

            this.cellBufferF.element(instanceIndex).assign(vec4(vx,vy,vz,mass));
        })().compute(cellCount);

        this.kernels.g2p = Fn(() => {
            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });
            const particleMass = this.particleBuffer.element(instanceIndex).get('mass').toConst("particleMass");
            const particleDensity = this.particleBuffer.element(instanceIndex).get('density').toConst("particleDensity");
            const particlePosition = this.particleBuffer.element(instanceIndex).get('position').xyz.toVar("particlePosition");
            const particleVelocity = vec3(0).toVar();
            // 重力を追加（常に適用）
            If(this.uniforms.gravityType.equal(uint(2)), () => {
                const pn = particlePosition.div(vec3(this.uniforms.gridSize.sub(1))).sub(0.5).normalize().toConst();
                particleVelocity.subAssign(pn.mul(0.3).mul(this.uniforms.dt));
            }).Else(() => {
                particleVelocity.addAssign(this.uniforms.gravity.mul(this.uniforms.dt));
            });
            
            // NOTE: デバッグ用の固定速度は入れない（本来のMLS-MPM挙動に戻す）

            // カールノイズ（フラグ管理、デフォルトOFF）
            If(this.uniforms.noise.greaterThan(0.0), () => {
                const noise = triNoise3Dvec(particlePosition.mul(0.015), time, 0.11).sub(0.285).normalize().mul(0.28).toVar();
                particleVelocity.subAssign(noise.mul(this.uniforms.noise).mul(this.uniforms.dt));
            });

            const cellIndex =  ivec3(particlePosition).sub(1).toConst("cellIndex");
            const cellDiff = particlePosition.fract().sub(0.5).toConst("cellDiff");

            const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
            const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
            const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
            const weights = array([w0,w1,w2]).toConst("weights");

            const B = mat3(0).toVar("B");
            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({gx}) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({gy}) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({gz}) => {
                        const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
                        const cellX = cellIndex.add(ivec3(gx,gy,gz)).toConst();
                        const cellDist = vec3(cellX).add(0.5).sub(particlePosition).toConst("cellDist");
                        const cellPtr = getCellPtr(cellX);

                        const weightedVelocity = this.cellBufferF.element(cellPtr).xyz.mul(weight).toConst("weightedVelocity");
                        const term = mat3(
                            weightedVelocity.mul(cellDist.x),
                            weightedVelocity.mul(cellDist.y),
                            weightedVelocity.mul(cellDist.z)
                        );
                        B.addAssign(term);
                        particleVelocity.addAssign(weightedVelocity);
                    });
                });
            });

            // マウス追従は無効化されているので、mouseForceがゼロの時はスキップ
            // （mouseRayDirectionがゼロだとdist=0→force=1.0になって全粒子に力が加わってしまう）
            const mouseForceMag = this.uniforms.mouseForce.length().toConst("mouseForceMag");
            const force = float(0.0).toVar("force");
            If(mouseForceMag.greaterThan(0.0001), () => {
                const dist = cross(this.uniforms.mouseRayDirection, particlePosition.mul(vec3(1,1,0.4)).sub(this.uniforms.mouseRayOrigin)).length();
                force.assign(dist.mul(0.1).oneMinus().max(0.0).pow(2));
            particleVelocity.addAssign(this.uniforms.mouseForce.mul(1).mul(force));
            });
            particleVelocity.mulAssign(particleMass); // to ensure difference between particles

            // Track5: impulse（ポリフォニック）
            // 近い粒子ほど強く押し出す（放射状）を maxImpulses 個ぶん加算
            const impulsePR = array([
                this.uniforms.impulsePR0, this.uniforms.impulsePR1, this.uniforms.impulsePR2, this.uniforms.impulsePR3,
                this.uniforms.impulsePR4, this.uniforms.impulsePR5, this.uniforms.impulsePR6, this.uniforms.impulsePR7
            ]).toConst("impulsePR");
            const impulseS = array([
                this.uniforms.impulseS0, this.uniforms.impulseS1, this.uniforms.impulseS2, this.uniforms.impulseS3,
                this.uniforms.impulseS4, this.uniforms.impulseS5, this.uniforms.impulseS6, this.uniforms.impulseS7
            ]).toConst("impulseS");

            Loop({ start: 0, end: 8, type: 'int', name: 'ii', condition: '<' }, ({ii}) => {
                const s = impulseS.element(ii).x.toConst("impS");
                If(s.abs().greaterThan(0.0001), () => {
                    const pr = impulsePR.element(ii).toConst("impPR"); // xyz=pos, w=radius
                    const to = particlePosition.sub(pr.xyz).toVar();
                    const d = to.length().toVar();
                    const radius = pr.w.max(0.0001);
                    const falloff = float(1).sub(d.div(radius)).clamp(0.0, 1.0);
                    const dir = select(d.greaterThan(0.0001), to.div(d), vec3(0.0));
                    particleVelocity.addAssign(dir.mul(falloff.mul(falloff)).mul(s).mul(this.uniforms.dt));
                });
            });

            this.particleBuffer.element(instanceIndex).get('C').assign(B.mul(4));
            particlePosition.addAssign(particleVelocity.mul(this.uniforms.dt));
            // 境界処理（壁セルを薄くして、箱の端まで寄れるようにする）
            // NOTE:
            // - MLS-MPMは3x3x3近傍参照をするため、粒子位置を完全に 0..64 へ開放するとセル参照が外れる
            // - 安全域として min=1.0、max=gridSize-1.001（int化で62に落ちる）にクランプする
            const wallMinF = vec3(1.0).toConst("wallMinF");
            const wallMaxF = vec3(this.uniforms.gridSize).sub(1.001).toConst("wallMaxF");
            particlePosition.assign(clamp(particlePosition, wallMinF, wallMaxF));

            const wallStiffness = 0.3;
            const xN = particlePosition.add(particleVelocity.mul(this.uniforms.dt).mul(3.0)).toConst("xN");
            // 壁の反発（クランプと同じ境界を使用）
            const wallMin = wallMinF.toConst("wallMin");
            const wallMax = wallMaxF.toConst("wallMax");
            If(xN.x.lessThan(wallMin.x), () => { particleVelocity.x.addAssign(wallMin.x.sub(xN.x).mul(wallStiffness)); });
            If(xN.x.greaterThan(wallMax.x), () => { particleVelocity.x.addAssign(wallMax.x.sub(xN.x).mul(wallStiffness)); });
            If(xN.y.lessThan(wallMin.y), () => { particleVelocity.y.addAssign(wallMin.y.sub(xN.y).mul(wallStiffness)); });
            If(xN.y.greaterThan(wallMax.y), () => { particleVelocity.y.addAssign(wallMax.y.sub(xN.y).mul(wallStiffness)); });
            If(xN.z.lessThan(wallMin.z), () => { particleVelocity.z.addAssign(wallMin.z.sub(xN.z).mul(wallStiffness)); });
            If(xN.z.greaterThan(wallMax.z), () => { particleVelocity.z.addAssign(wallMax.z.sub(xN.z).mul(wallStiffness)); });

            this.particleBuffer.element(instanceIndex).get('position').assign(particlePosition)
            this.particleBuffer.element(instanceIndex).get('velocity').assign(particleVelocity)

            const direction = this.particleBuffer.element(instanceIndex).get('direction');
            direction.assign(mix(direction,particleVelocity, 0.1));

            // ヒートマップ（力が強い=赤、何もない=青）
            // - mouseForce: distから作ったforce（0..1）
            // - impulseForce: Track5のimpulse（強度 * falloff^2）
            // NOTE:
            // - ライブ用途で setMouseRay() を無効化しているため、rayDirectionがゼロ→dist=0→force=1 になりがち
            // - そのままだと全粒子が常に赤になるので、「mouseForce が実際に入っている時だけ」ヒートに寄与させる
            const mouseForceMag01 = this.uniforms.mouseForce.length().mul(0.5).clamp(0.0, 1.0).toConst("mouseForceMag01");
            const mouseForce01 = force.mul(mouseForceMag01).clamp(0.0, 1.0).toConst("mouseForce01");

            // 閾値を下げる（弱い力でも赤みが乗るように）
            // - 係数を上げて全体のレンジを広げる
            // - sqrtで低域を持ち上げる（0.0付近が潰れにくい）
            // impulseのヒートは「最大値」を採用（複数同時でも色が出る）
            const impulseHeat = float(0.0).toVar("impulseHeat");
            Loop({ start: 0, end: 8, type: 'int', name: 'hi', condition: '<' }, ({hi}) => {
                const s = impulseS.element(hi).x.toConst("hS");
                If(s.abs().greaterThan(0.0001), () => {
                    const pr = impulsePR.element(hi).toConst("hPR");
                    const to = particlePosition.sub(pr.xyz).toVar();
                    const d = to.length().toVar();
                    const radius = pr.w.max(0.0001);
                    const falloff = float(1).sub(d.div(radius)).clamp(0.0, 1.0);
                    const f = falloff.mul(falloff).mul(s.abs()).mul(1.0).clamp(0.0, 1.0);
                    impulseHeat.assign(max(impulseHeat, f));
                });
            });

            // Heatmap（運動=実移動量）に連動したHSLマッピング：青 → 赤
            // - 速度そのものだと“常に微振動”で赤に張り付きやすいので、1フレの移動量（|v|*dt）で見る
            // - 低速域の差が見えるように、min/maxで正規化してからカーブをかける
            const speed = particleVelocity.length().toConst("pSpeed");
            const move = speed.mul(this.uniforms.dt).toConst("pMove"); // 1stepの移動量
            const vMin = this.uniforms.heatSpeedMin.toConst("vMin");
            const vMax = this.uniforms.heatSpeedMax.max(vMin.add(0.000001)).toConst("vMax");
            const t0 = move.sub(vMin).div(vMax.sub(vMin)).clamp(0.0, 1.0).toConst("t0");
            // smoothstep相当（低速〜停止付近の差を出す）
            const t = t0.mul(t0).mul(float(3.0).sub(t0.mul(2.0))).toConst("t");
            // 赤に行きにくくして“止まったら青に戻る”を分かりやすく
            const heat = pow(t, float(1.8)).clamp(0.0, 1.0).toConst("heat");

            // HSL: hue=0.66(青) → 0.0(赤)
            const hue = mix(float(0.66), float(0.0), heat).toConst("hue");
            const sat = float(1.0).toConst("sat");
            const light = mix(float(0.35), float(0.55), heat).toConst("light");

            // hsl2rgb（分岐なしの定番式）
            const c = float(1.0).sub(abs(light.mul(2.0).sub(1.0))).mul(sat).toConst("c");
            const hp = fract(vec3(hue).add(vec3(0.0, 2.0 / 3.0, 1.0 / 3.0))).mul(6.0).toConst("hp");
            const rgb0 = clamp(abs(hp.sub(3.0)).sub(1.0), 0.0, 1.0).toConst("rgb0");
            const color = rgb0.sub(0.5).mul(c).add(light).clamp(0.0, 1.0).toConst("heatColor");
            this.particleBuffer.element(instanceIndex).get('color').assign(color);
        })().compute(1);

        // ===== Reset particles (GPU) =====
        const rand = (seed) => fract( sin( seed ).mul( 43758.5453 ) ); // 0..1

        this.kernels.resetParticles = Fn(() => {
            If( instanceIndex.greaterThanEqual( uint( maxParticles ) ), () => { Return(); } );

            const id = float( instanceIndex );
            const r1 = rand( id.mul( 12.9898 ).add( 1.0 ) );
            const r2 = rand( id.mul( 78.233 ).add( 2.0 ) );
            const r3 = rand( id.mul( 39.3467 ).add( 3.0 ) );
            const r4 = rand( id.mul( 11.135 ).add( 4.0 ) );
            const r5 = rand( id.mul( 27.719 ).add( 5.0 ) );

            const raw = vec3( r1.mul(2).sub(1), r2.mul(2).sub(1), r3.mul(2).sub(1) );
            const dir = raw.add( 0.0001 ).normalize();
            const radius = pow( r4, 0.3333333 ); // 体積一様っぽく
            // 初期配置を箱の壁際まで寄せる（サンプル由来の0.8制限を緩める）
            const p = dir.mul( radius ).mul( 0.95 ).add( 1.0 ).div( 2.0 ).mul( vec3( this.uniforms.gridSize ) );

            const mass = float(1.0).sub( r5.mul( 0.002 ) );

            const particle = this.particleBuffer.element( instanceIndex );
            particle.get('position').assign( p );
            particle.get('velocity').assign( vec3(0) );
            particle.get('mass').assign( mass );
            particle.get('density').assign( 0.0 );
            particle.get('C').assign( mat3(0) );
            particle.get('direction').assign( vec3(0,0,1) );
            particle.get('color').assign( vec3(0) );
        })().compute( maxParticles );
        
        // 初期パーティクル数でカーネルのdispatch countを設定
        this.kernels.p2g1.count = this.numParticles;
        this.kernels.p2g1.updateDispatchCount();
        this.kernels.p2g2.count = this.numParticles;
        this.kernels.p2g2.updateDispatchCount();
        this.kernels.g2p.count = this.numParticles;
        this.kernels.g2p.updateDispatchCount();
    }

    setMouseRay(origin, direction, pos) {
        // マウス追従は不要なので無視（互換のため残す）
        return;
        origin.multiplyScalar(64);
        pos.multiplyScalar(64);
        origin.add(new THREE.Vector3(32,0,0));
        this.uniforms.mouseRayDirection.value.copy(direction.normalize());
        this.uniforms.mouseRayOrigin.value.copy(origin);
        this.mousePos.copy(pos);
    }

    /**
     * Track5: パーティクルに力を加える（位置/強度/持続）
     * scene08互換：前回のシーケンスと発音タイミングが近ければ近くで、間が開けば開くほど遠い場所で力が発生
     * - noteNumber: 0-127 → 高さY
     * - velocity: 0-127 → 強度
     * - durationMs: ms → 持続時間（短いほど前回の位置に近い）
     */
    applyTrack5Force(noteNumber = 64, velocity = 127, durationMs = 120) {
        const now = Date.now();
        const dur = Math.max(0, Number(durationMs) || 0);
        const effectiveDuration = dur > 0 ? dur : 120;

        // 境界（wallMin=1, wallMax=63、範囲62）
        // NOTE: 実際の粒子位置は max=62.999 でクランプされる（近傍参照の安全域）
        const boxMin = 1;
        const boxMax = 63;
        const boxRange = boxMax - boxMin; // 62

        let x, y, z;
        
        // 位置のランダム性を強める（Box内でより散る）
        // - yも「ノート固定」ではなくランダムを混ぜる
        // - ロール時の「前回近傍」拘束は弱め（超短い時だけ少し残す）
        const note01 = Math.min(Math.max((Number(noteNumber) ?? 64) / 127, 0), 1);
        const rand01 = () => Math.random();

        // デュレーションが短い（ロール）場合は前回の位置に近づける（scene08互換）
        if (effectiveDuration > 0 && effectiveDuration < 150 && this.lastForceCenter) {
            // 超短いロールだけ「少し」近傍に寄せる（でも散らす）
            const proximityFactor = Math.max(0, 1.0 - effectiveDuration / 150.0); // 0-1
            const minDistance = boxRange * 0.15 + proximityFactor * boxRange * 0.05; // 9.3..12.4
            const maxDistance = boxRange * 0.45; // 27.9

            const angle = Math.random() * Math.PI * 2;
            const distance = minDistance + Math.random() * (maxDistance - minDistance);
            x = this.lastForceCenter.x + Math.cos(angle) * distance;
            z = this.lastForceCenter.z + Math.sin(angle) * distance;

            // 範囲内にクランプ（回り込みはやめて素直にランダム性優先）
            x = Math.min(Math.max(x, boxMin), boxMax);
            z = Math.min(Math.max(z, boxMin), boxMax);
        } else {
            // 基本は完全ランダム
            x = boxMin + rand01() * boxRange;
            z = boxMin + rand01() * boxRange;
        }
        
        // yは「ノート」30% + 「ランダム」70% で、よりBox内に散らす
        const y01 = note01 * 0.3 + rand01() * 0.7;
        y = boxMin + y01 * boxRange;

        // 前回の位置を更新
        this.lastForceCenter = new THREE.Vector3(x, y, z);

        // 強度（velocityに比例、durationが長いほど少し弱めに）
        const v01 = Math.min(Math.max((Number(velocity) || 0) / 127, 0), 1);
        const durationScale = 1 / Math.sqrt(Math.max(effectiveDuration / 120, 1)); // 長いほど弱い
        // もっと大きく吹き飛ばす（Track5を強めに）
        // NOTE: dtが掛かるので、係数で体感を作る
        // 体感が遅いので少し強める
        const strength = 14.0 * v01 * durationScale;

        // 半径（durationが長いほど広い、全体的に少し大きめ）
        const radius = 14 + Math.min(effectiveDuration / 120, 30); // 14..44

        // 空きスロット、なければ最も早く終わるものを上書き
        let slot = -1;
        for (let i = 0; i < this.maxImpulses; i++) {
            const imp = this.impulses[i];
            if (!imp || now > imp.endMs) { slot = i; break; }
        }
        if (slot < 0) {
            let best = 0;
            let bestEnd = this.impulses[0]?.endMs ?? now;
            for (let i = 1; i < this.maxImpulses; i++) {
                const endMs = this.impulses[i]?.endMs ?? now;
                if (endMs < bestEnd) { bestEnd = endMs; best = i; }
            }
            slot = best;
        }

        this.impulses[slot] = {
            startMs: now,
            endMs: now + effectiveDuration,
            baseStrength: strength,
            radius,
            pos: new THREE.Vector3(x, y, z),
            currentStrength: strength
        };

        // 呼び出し元（App側インジケータ）にスロットを返す
        return {
            slot,
            startMs: now,
            endMs: now + effectiveDuration,
            baseStrength: strength,
            radius,
            pos: new THREE.Vector3(x, y, z)
        };
    }

    async update(interval, elapsed) {
        const { particles, run, noise, dynamicViscosity, stiffness, restDensity, speed, gravity, gravitySensorReading, accelerometerReading, heatSpeedMin, heatSpeedMax } = conf;

        // Track5以外で動かさない：ノイズ/重力は無効化（impulseだけで動かす）
        this.uniforms.noise.value = this.onlyImpulseMotion ? 0.0 : noise;
        this.uniforms.stiffness.value = stiffness;
        this.uniforms.gravityType.value = this.onlyImpulseMotion ? 0 : gravity;
        if (this.onlyImpulseMotion) {
            this.uniforms.gravity.value.set(0, 0, 0);
        } else {
            if (gravity === 0) {
                this.uniforms.gravity.value.set(0,0,0.2);
            } else if (gravity === 1) {
                this.uniforms.gravity.value.set(0,-0.2,0);
            } else if (gravity === 3) {
                this.uniforms.gravity.value.copy(gravitySensorReading).add(accelerometerReading);
            }
        }
        this.uniforms.dynamicViscosity.value = dynamicViscosity;
        this.uniforms.restDensity.value = restDensity;

        if (particles !== this.numParticles) {
            this.numParticles = particles;
            this.uniforms.numParticles.value = particles;
            this.kernels.p2g1.count = particles;
            this.kernels.p2g1.updateDispatchCount();
            this.kernels.p2g2.count = particles;
            this.kernels.p2g2.updateDispatchCount();
            this.kernels.g2p.count = particles;
            this.kernels.g2p.updateDispatchCount();
        }

        interval = Math.min(interval, 1/60);
        const dt = interval * 6 * speed;
        this.uniforms.dt.value = dt;

        // マウス追従はしないのでmouseForceは常に0
        this.uniforms.mouseForce.value.set(0, 0, 0);

        // ヒートマップのレンジ（速度→色）
        this.uniforms.heatSpeedMin.value = Number(heatSpeedMin ?? 0.002);
        this.uniforms.heatSpeedMax.value = Number(heatSpeedMax ?? 0.05);

        // Track5 impulse: スロットごとにdurationで減衰（終わったら0）
        const nowMs = Date.now();
        let impulseActive = false;
        for (let i = 0; i < this.maxImpulses; i++) {
            const imp = this.impulses[i];
            let strengthNow = 0.0;
            let radiusNow = 1.0;
            let posNow = null;

            if (imp && nowMs <= imp.endMs) {
                const t = (nowMs - imp.startMs) / Math.max(imp.endMs - imp.startMs, 1);
                const fade = Math.max(0, 1 - t); // 線形フェードアウト
                strengthNow = imp.baseStrength * fade;
                radiusNow = imp.radius;
                posNow = imp.pos;
                imp.currentStrength = strengthNow;
                if (Math.abs(strengthNow) > 0.0001) impulseActive = true;
            } else if (imp) {
                imp.currentStrength = 0.0;
            }

            // uniforms更新
            const prU = this.uniforms[`impulsePR${i}`];
            const sU = this.uniforms[`impulseS${i}`];
            if (prU && sU) {
                if (posNow) {
                    prU.value.set(posNow.x, posNow.y, posNow.z, radiusNow);
                } else {
                    // 半径だけ0にして無効化
                    prU.value.set(0, 0, 0, 1.0);
                }
                sU.value.set(strengthNow, 0, 0, 0);
            }
        }
        
        // Track5以外では完全停止
        if (this.freezeWhenNoImpulse && !impulseActive) {
            return;
        }
        
        // impulseActiveの状態を保存（外部から参照可能にするため）
        this._lastImpulseActive = impulseActive;
        
        if (run) {
            const kernels = [this.kernels.clearGrid, this.kernels.p2g1, this.kernels.p2g2, this.kernels.updateGrid, this.kernels.g2p];
            await this.renderer.computeAsync(kernels);
        }
    }
    
    /**
     * 現在アクティブなimpulseがあるかどうかを返す（update()を呼ばなくてもチェック可能）
     * @returns {boolean}
     */
    hasAnyActiveImpulse() {
        const nowMs = Date.now();
        for (let i = 0; i < this.maxImpulses; i++) {
            const imp = this.impulses[i];
            if (imp && nowMs <= imp.endMs) {
                const t = (nowMs - imp.startMs) / Math.max(imp.endMs - imp.startMs, 1);
                const fade = Math.max(0, 1 - t);
                const strengthNow = imp.baseStrength * fade;
                if (Math.abs(strengthNow) > 0.0001) {
                    return true;
                }
            }
        }
        return false;
    }

    async resetParticles() {
        if (!this.kernels.resetParticles) return;
        // パーティクルをリセット（速度を0に、密度も0に）
        await this.renderer.computeAsync([ this.kernels.resetParticles ]);
        // Gridもクリアして、残っているVelocityを消す
        const cellCount = this.gridSize.x * this.gridSize.y * this.gridSize.z;
        await this.renderer.computeAsync([ this.kernels.clearGrid ]);
        // もう一度Gridをクリアして、確実にVelocityを消す（p2g1/p2g2で書き込まれたVelocityを消すため）
        await this.renderer.computeAsync([ this.kernels.clearGrid ]);
    }
}

export default mlsMpmSimulator;