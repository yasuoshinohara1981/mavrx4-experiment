/**
 * RibbonSystem (GPU版)
 * 大量のリボン（紐）をGPUで物理シミュレーション
 * RenderTargetとシェーダーで位置・速度を更新
 */

import * as THREE from "three/webgpu";
import {
    Fn,
    uniform,
    float,
    vec2,
    vec3,
    vec4,
    texture,
    attribute,
    uv,
    sin,
    cos,
    floor,
    max,
    min,
    normalize,
    cross,
    mix,
    step,
    abs
} from "three/tsl";

export class RibbonSystem {
    constructor(renderer, ribbonCount = 200, segmentsPerRibbon = 30) {
        this.renderer = renderer;
        this.ribbonCount = ribbonCount;
        this.segmentsPerRibbon = segmentsPerRibbon;
        this.totalSegments = ribbonCount * segmentsPerRibbon;
        
        // テクスチャサイズ（全セグメントを1次元配列として配置）
        // 各リボンを1行として、セグメントを列として配置
        this.textureWidth = segmentsPerRibbon;
        this.textureHeight = ribbonCount;
        
        // RenderTarget（ping-pong）
        this.positionRenderTargets = [null, null];
        this.velocityRenderTargets = [null, null];
        this.currentBuffer = 0;
        
        // 更新用シェーダー
        this.updateMaterial = null;
        this.updateScene = null;
        this.updateCamera = null;
        this.updateMesh = null;
        
        // 描画用メッシュ
        this.ribbonMeshes = [];
        
        // 物理パラメータ
        this.gravity = -0.0005;
        this.stiffness = 0.15;
        this.damping = 0.95;
        this.repulsionStrength = 0.0001;
        this.restLength = 0.3;
        
        // リボンの範囲
        this.spawnRadius = 8.0;
        this.maxHeight = 15.0;
        this.minHeight = 0.0;
        
        // リボンの基本情報
        this.ribbonData = [];
    }
    
    async init() {
        try {
            // リボンの基本情報を初期化
            this._initRibbonData();
            
            // RenderTargetを作成
            this._createRenderTargets();
            
            // 更新用シェーダーを作成（一旦無効化）
            this._createUpdateShader();
            
            // 初期位置をRenderTargetに書き込む（テクスチャを作成）
            this._initializeRenderTargets();
            
            // 描画用メッシュを作成（テクスチャが作成された後）
            this._createRenderMeshes();
            
            console.log('RibbonSystem initialized:', {
                ribbonCount: this.ribbonCount,
                segmentsPerRibbon: this.segmentsPerRibbon,
                textureSize: `${this.textureWidth}x${this.textureHeight}`
            });
        } catch (error) {
            console.error('RibbonSystem init error:', error);
            throw error;
        }
    }
    
    _initRibbonData() {
        this.ribbonData = [];
        for (let i = 0; i < this.ribbonCount; i++) {
            const basePosition = new THREE.Vector3(
                (Math.random() - 0.5) * this.spawnRadius * 2,
                0,
                (Math.random() - 0.5) * this.spawnRadius * 2
            );
            const targetHeight = this.minHeight + Math.random() * (this.maxHeight - this.minHeight);
            const color = new THREE.Color().setHSL(
                (i * 0.1) % 1.0,
                0.7,
                0.5 + Math.random() * 0.3
            );
            
            this.ribbonData.push({
                basePosition,
                targetHeight,
                color,
                radius: 0.02 + Math.random() * 0.03
            });
        }
    }
    
    _updateCPU(deltaTime) {
        // CPUで簡易更新（パフォーマンスは劣るが、動作確認用）
        const dt = Math.min(deltaTime * 0.001, 0.1);
        
        // テクスチャデータを更新
        if (!this._initialPositionTexture) return;
        
        const positions = this._initialPositionTexture.image.data;
        const width = this.textureWidth;
        const height = this.textureHeight;
        
        // 各リボンの各セグメントを更新
        for (let ribbonIndex = 0; ribbonIndex < this.ribbonCount; ribbonIndex++) {
            const ribbon = this.ribbonData[ribbonIndex];
            
            for (let segIndex = 0; segIndex < this.segmentsPerRibbon; segIndex++) {
                const index = (ribbonIndex * width + segIndex) * 4;
                
                // 最初のセグメント（地面）は固定
                if (segIndex === 0) {
                    positions[index] = ribbon.basePosition.x;
                    positions[index + 1] = ribbon.basePosition.y;
                    positions[index + 2] = ribbon.basePosition.z;
                    continue;
                }
                
                // 現在の位置
                const x = positions[index];
                const y = positions[index + 1];
                const z = positions[index + 2];
                const pos = new THREE.Vector3(x, y, z);
                
                // 前のセグメントの位置
                const prevIndex = ((ribbonIndex * width + (segIndex - 1)) * 4);
                const prevPos = new THREE.Vector3(
                    positions[prevIndex],
                    positions[prevIndex + 1],
                    positions[prevIndex + 2]
                );
                
                // バネ力
                const toPrev = new THREE.Vector3().subVectors(prevPos, pos);
                const distance = toPrev.length();
                const restLength = this.restLength;
                const springForce = toPrev.normalize().multiplyScalar(
                    (distance - restLength) * this.stiffness
                );
                
                // 重力
                const gravityForce = new THREE.Vector3(0, this.gravity, 0);
                
                // 速度（簡易版：前フレームとの差分）
                const velocity = new THREE.Vector3(0, 0, 0); // 簡易版では速度を保持しない
                
                // 力を適用
                velocity.add(springForce.multiplyScalar(dt));
                velocity.add(gravityForce.multiplyScalar(dt));
                velocity.multiplyScalar(this.damping);
                
                // 位置を更新
                pos.add(velocity.multiplyScalar(dt));
                
                // 高さ制限
                if (pos.y < ribbon.basePosition.y) {
                    pos.y = ribbon.basePosition.y;
                }
                if (pos.y > ribbon.targetHeight * 1.5) {
                    pos.y = ribbon.targetHeight * 1.5;
                }
                
                // テクスチャに書き戻し
                positions[index] = pos.x;
                positions[index + 1] = pos.y;
                positions[index + 2] = pos.z;
            }
        }
        
        // テクスチャを更新
        this._initialPositionTexture.needsUpdate = true;
        
        // 描画用メッシュのuniformを更新
        for (const mesh of this.ribbonMeshes) {
            if (mesh.material.userData.positionTextureUniform) {
                mesh.material.userData.positionTextureUniform.value = this._initialPositionTexture;
            }
        }
    }
    
    _createDummyTexture() {
        // ダミーテクスチャを作成（シェーダービルド時のエラー回避用）
        const dummyData = new Float32Array(this.textureWidth * this.textureHeight * 4);
        // すべて0で初期化
        for (let i = 0; i < dummyData.length; i += 4) {
            dummyData[i] = 0;     // x
            dummyData[i + 1] = 0;  // y
            dummyData[i + 2] = 0;  // z
            dummyData[i + 3] = 1;  // w
        }
        const dummyTexture = new THREE.DataTexture(
            dummyData,
            this.textureWidth,
            this.textureHeight,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        dummyTexture.needsUpdate = true;
        return dummyTexture;
    }
    
    _createRenderTargets() {
        const rtOptions = {
            type: THREE.FloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            generateMipmaps: false
        };
        
        this.positionRenderTargets[0] = new THREE.WebGLRenderTarget(
            this.textureWidth,
            this.textureHeight,
            rtOptions
        );
        
        this.positionRenderTargets[1] = new THREE.WebGLRenderTarget(
            this.textureWidth,
            this.textureHeight,
            rtOptions
        );
        
        this.velocityRenderTargets[0] = new THREE.WebGLRenderTarget(
            this.textureWidth,
            this.textureHeight,
            rtOptions
        );
        
        this.velocityRenderTargets[1] = new THREE.WebGLRenderTarget(
            this.textureWidth,
            this.textureHeight,
            rtOptions
        );
    }
    
    _createUpdateShader() {
        this.updateScene = new THREE.Scene();
        this.updateCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        // WebGPUではShaderMaterialが使えないので、一旦無効化
        // TODO: NodeMaterialで更新シェーダーを実装する必要がある
        console.warn('RibbonSystem: 更新シェーダーは未実装（WebGPU対応が必要）。初期位置のみ表示されます。');
        this.updateMaterial = null;
        
        // 一旦コメントアウト（WebGPU対応が必要）
        /*
        this.updateMaterial = new THREE.ShaderMaterial({
            uniforms: {
                positionTexture: { value: null },
                velocityTexture: { value: null },
                deltaTime: { value: 0.0 },
                textureWidth: { value: this.textureWidth },
                textureHeight: { value: this.textureHeight },
                stiffness: { value: this.stiffness },
                damping: { value: this.damping },
                restLength: { value: this.restLength },
                gravity: { value: this.gravity },
                repulsionStrength: { value: this.repulsionStrength },
                spawnRadius: { value: this.spawnRadius },
                maxHeight: { value: this.maxHeight }
            },
            vertexShader: `
                void main() {
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D positionTexture;
                uniform sampler2D velocityTexture;
                uniform float deltaTime;
                uniform float textureWidth;
                uniform float textureHeight;
                uniform float stiffness;
                uniform float damping;
                uniform float restLength;
                uniform float gravity;
                uniform float repulsionStrength;
                
                vec2 getUV(int x, int y) {
                    return vec2((float(x) + 0.5) / textureWidth, (float(y) + 0.5) / textureHeight);
                }
                
                void main() {
                    vec2 uv = gl_FragCoord.xy / vec2(textureWidth, textureHeight);
                    int segIndex = int(floor(gl_FragCoord.x));
                    int ribbonIndex = int(floor(gl_FragCoord.y));
                    
                    if (segIndex < 0 || segIndex >= int(textureWidth) || 
                        ribbonIndex < 0 || ribbonIndex >= int(textureHeight)) {
                        discard;
                        return;
                    }
                    
                    // 現在の位置と速度を取得
                    vec4 posData = texture2D(positionTexture, uv);
                    vec4 velData = texture2D(velocityTexture, uv);
                    vec3 position = posData.xyz;
                    vec3 velocity = velData.xyz;
                    
                    // 最初のセグメント（地面）は固定
                    if (segIndex == 0) {
                        // 基本位置を計算（ribbonIndexから）
                        float ribbonId = float(ribbonIndex);
                        float baseX = (mod(ribbonId * 7.13, 1.0) - 0.5) * spawnRadius * 2.0;
                        float baseZ = (mod(ribbonId * 11.37, 1.0) - 0.5) * spawnRadius * 2.0;
                        position = vec3(baseX, 0.0, baseZ);
                        velocity = vec3(0.0);
                    } else {
                        // 前のセグメントとのバネ力
                        vec2 prevUV = getUV(segIndex - 1, ribbonIndex);
                        vec4 prevPosData = texture2D(positionTexture, prevUV);
                        vec3 prevPos = prevPosData.xyz;
                        
                        vec3 toPrev = prevPos - position;
                        float dist = length(toPrev);
                        vec3 springForce = vec3(0.0);
                        if (dist > 0.001) {
                            vec3 dir = normalize(toPrev);
                            float stretch = dist - restLength;
                            springForce = dir * stretch * stiffness;
                        }
                        
                        // 重力
                        vec3 gravityForce = vec3(0.0, gravity, 0.0);
                        
                        // 他のリボンとの反発力（簡易版：近くのセグメントのみ）
                        vec3 repulsionForce = vec3(0.0);
                        // パフォーマンスのため、同じリボンの前後のセグメントのみチェック
                        // （全リボンとの衝突判定は重いので簡略化）
                        
                        // 力を適用
                        vec3 force = springForce + gravityForce + repulsionForce;
                        velocity += force * deltaTime;
                        velocity *= damping;
                        
                        // 位置を更新
                        position += velocity * deltaTime;
                        
                        // 高さ制限
                        float targetHeight = maxHeight * (0.5 + mod(ribbonId * 3.17, 0.5));
                        if (position.y < 0.0) {
                            position.y = 0.0;
                            velocity.y = max(0.0, velocity.y);
                        }
                        if (position.y > targetHeight * 1.5) {
                            position.y = targetHeight * 1.5;
                            velocity.y = min(0.0, velocity.y);
                        }
                    }
                    
                    // 位置を出力
                    gl_FragColor = vec4(position, 1.0);
                }
            `
        });
        
        const updateGeometry = new THREE.PlaneGeometry(2, 2);
        this.updateMesh = new THREE.Mesh(updateGeometry, this.updateMaterial);
        this.updateScene.add(this.updateMesh);
        */
    }
    
    _initializeRenderTargets() {
        // 初期位置を計算してRenderTargetに書き込む
        const initPositions = new Float32Array(this.textureWidth * this.textureHeight * 4);
        const initVelocities = new Float32Array(this.textureWidth * this.textureHeight * 4);
        
        for (let ribbonIndex = 0; ribbonIndex < this.ribbonCount; ribbonIndex++) {
            const ribbon = this.ribbonData[ribbonIndex];
            
            for (let segIndex = 0; segIndex < this.segmentsPerRibbon; segIndex++) {
                const t = segIndex / (this.segmentsPerRibbon - 1);
                const height = t * ribbon.targetHeight * (0.5 + Math.random() * 0.5);
                
                const offset = new THREE.Vector3(
                    (Math.random() - 0.5) * 0.2,
                    0,
                    (Math.random() - 0.5) * 0.2
                );
                
                const point = ribbon.basePosition.clone().add(
                    new THREE.Vector3(0, height, 0)
                ).add(offset);
                
                const index = (ribbonIndex * this.textureWidth + segIndex) * 4;
                initPositions[index] = point.x;
                initPositions[index + 1] = point.y;
                initPositions[index + 2] = point.z;
                initPositions[index + 3] = 1.0;
                
                initVelocities[index] = 0.0;
                initVelocities[index + 1] = 0.0;
                initVelocities[index + 2] = 0.0;
                initVelocities[index + 3] = 0.0;
            }
        }
        
        // DataTextureを作成して初期データを設定
        try {
            const positionTexture = new THREE.DataTexture(
                initPositions,
                this.textureWidth,
                this.textureHeight,
                THREE.RGBAFormat,
                THREE.FloatType
            );
            positionTexture.needsUpdate = true;
            // テクスチャが確実に初期化されるまで待つ
            // WebGPUでは、テクスチャの初期化が非同期の場合があるため
            if (this.renderer && this.renderer.init) {
                // レンダラーが初期化されている場合、テクスチャを明示的に更新
                positionTexture.needsUpdate = true;
            }
            
            const velocityTexture = new THREE.DataTexture(
                initVelocities,
                this.textureWidth,
                this.textureHeight,
                THREE.RGBAFormat,
                THREE.FloatType
            );
            velocityTexture.needsUpdate = true;
            
            // 描画用メッシュに初期テクスチャを設定（後で設定される）
            this._initialPositionTexture = positionTexture;
            this._initialVelocityTexture = velocityTexture;
            
            // テクスチャが有効であることを確認
            if (!this._initialPositionTexture || !this._initialPositionTexture.image) {
                throw new Error('テクスチャのimageプロパティが無効です');
            }
            
            console.log('RibbonSystem: 初期テクスチャ作成成功', {
                textureSize: `${this.textureWidth}x${this.textureHeight}`,
                hasTexture: !!this._initialPositionTexture,
                hasImage: !!this._initialPositionTexture?.image,
                imageType: this._initialPositionTexture?.image?.constructor?.name || 'unknown'
            });
        } catch (error) {
            console.error('RibbonSystem: 初期テクスチャの作成エラー:', error);
            // エラーが発生した場合はダミーテクスチャを作成
            if (!this._initialPositionTexture) {
                this._initialPositionTexture = this._createDummyTexture();
                console.log('RibbonSystem: ダミーテクスチャを使用');
            }
        }
    }
    
    _createRenderMeshes() {
        // テクスチャが確実に存在することを確認
        if (!this._initialPositionTexture) {
            console.warn('RibbonSystem: テクスチャが存在しないため、ダミーテクスチャを作成');
            this._initialPositionTexture = this._createDummyTexture();
        }
        
        // uniform()に渡す前に、テクスチャが有効であることを確認
        // TSLのtexture()関数は有効なTHREE.Textureインスタンスを要求する
        const positionTexture = this._initialPositionTexture;
        if (!positionTexture || !(positionTexture instanceof THREE.Texture)) {
            console.error('RibbonSystem: 無効なテクスチャです。ダミーテクスチャを作成します。');
            this._initialPositionTexture = this._createDummyTexture();
        }
        
        // 各リボンのメッシュを作成
        for (let i = 0; i < this.ribbonCount; i++) {
            const ribbon = this.ribbonData[i];
            
            // ジオメトリを作成（セグメント数×8角形の断面）
            const geometry = new THREE.BufferGeometry();
            const vertices = [];
            const uvs = [];
            const indices = [];
            
            // セグメントごとに8角形の断面を作成
            for (let seg = 0; seg < this.segmentsPerRibbon; seg++) {
                for (let rad = 0; rad < 8; rad++) {
                    // ダミーの位置（後でシェーダーで上書き）
                    vertices.push(0, 0, 0);
                    uvs.push(seg / (this.segmentsPerRibbon - 1), rad / 8);
                }
            }
            
            // インデックスを生成
            for (let seg = 0; seg < this.segmentsPerRibbon - 1; seg++) {
                for (let rad = 0; rad < 8; rad++) {
                    const current = seg * 8 + rad;
                    const next = seg * 8 + ((rad + 1) % 8);
                    const currentNext = (seg + 1) * 8 + rad;
                    const nextNext = (seg + 1) * 8 + ((rad + 1) % 8);
                    
                    indices.push(current, next, currentNext);
                    indices.push(next, nextNext, currentNext);
                }
            }
            
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geometry.setIndex(indices);
            
            // NodeMaterialを使用
            const material = new THREE.MeshStandardNodeMaterial({
                color: ribbon.color,
                metalness: 0.3,
                roughness: 0.7,
                side: THREE.DoubleSide
            });
            
            // Uniformを定義（初期テクスチャを設定）
            // この時点で確実に有効なテクスチャが存在することを確認済み
            // uniform()を呼ぶ前に、テクスチャが確実に有効であることを再確認
            let textureToUse = this._initialPositionTexture;
            if (!textureToUse || !(textureToUse instanceof THREE.Texture)) {
                console.error(`RibbonSystem: メッシュ${i}作成時、テクスチャが無効です（Textureインスタンスではない）。ダミーテクスチャを使用します。`);
                textureToUse = this._createDummyTexture();
                this._initialPositionTexture = textureToUse;
            } else if (!textureToUse.image) {
                console.error(`RibbonSystem: メッシュ${i}作成時、テクスチャのimageプロパティが無効です。ダミーテクスチャを使用します。`);
                textureToUse = this._createDummyTexture();
                this._initialPositionTexture = textureToUse;
            }
            // テクスチャが確実に更新されるようにする
            textureToUse.needsUpdate = true;
            const positionTextureUniform = uniform(textureToUse);
            const textureWidthUniform = uniform(this.textureWidth);
            const textureHeightUniform = uniform(this.textureHeight);
            const ribbonIndexUniform = uniform(i);
            const radiusUniform = uniform(ribbon.radius);
            
            // positionNodeでテクスチャから位置を読み取る
            material.positionNode = Fn(() => {
                // UVからセグメントインデックスと半径インデックスを計算
                const u = attribute('uv').x;
                const v = attribute('uv').y;
                
                // セグメントインデックス（0..segmentsPerRibbon-1）
                const segIndex = floor(u.mul(float(this.segmentsPerRibbon - 1)));
                // 半径インデックス（0..7）
                const radIndex = floor(v.mul(8.0));
                
                // テクスチャUVを計算
                const texU = segIndex.add(0.5).div(textureWidthUniform);
                const texV = ribbonIndexUniform.add(0.5).div(textureHeightUniform);
                const texUV = vec2(texU, texV);
                
                // テクスチャから位置を読み取る
                const posData = texture(positionTextureUniform, texUV);
                const centerPos = posData.xyz;
                
                // 前後のセグメントから接線を計算
                const prevSegIndex = max(segIndex.sub(1.0), 0.0);
                const nextSegIndex = min(segIndex.add(1.0), float(this.segmentsPerRibbon - 1));
                
                const prevTexU = prevSegIndex.add(0.5).div(textureWidthUniform);
                const nextTexU = nextSegIndex.add(0.5).div(textureWidthUniform);
                
                const prevPos = texture(positionTextureUniform, vec2(prevTexU, texV)).xyz;
                const nextPos = texture(positionTextureUniform, vec2(nextTexU, texV)).xyz;
                const tangent = normalize(nextPos.sub(prevPos));
                
                // 法線とビノルマルを計算
                const up = vec3(0.0, 1.0, 0.0);
                const normal = mix(
                    normalize(cross(tangent, up)),
                    vec3(1.0, 0.0, 0.0),
                    step(0.9, abs(tangent.y))
                );
                const binormal = normalize(cross(tangent, normal));
                
                // 円形の断面を作成
                const angle = radIndex.div(8.0).mul(6.28318530718); // 2π
                const cosAngle = cos(angle);
                const sinAngle = sin(angle);
                const offset = normal.mul(cosAngle).add(binormal.mul(sinAngle)).mul(radiusUniform);
                
                return centerPos.add(offset);
            })();
            
            // uniformを保存（後で更新するため）
            material.userData.positionTextureUniform = positionTextureUniform;
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            
            this.ribbonMeshes.push(mesh);
        }
        
        // 初期テクスチャを設定
        if (this._initialPositionTexture) {
            for (const mesh of this.ribbonMeshes) {
                if (mesh.material.userData.positionTextureUniform) {
                    mesh.material.userData.positionTextureUniform.value = this._initialPositionTexture;
                }
            }
        }
    }
    
    update(deltaTime) {
        // 更新シェーダーが未実装の場合はCPUで簡易更新
        if (!this.updateMaterial) {
            this._updateCPU(deltaTime);
            return;
        }
        
        const dt = Math.min(deltaTime * 0.001, 0.1);
        
        // Uniformを更新
        this.updateMaterial.uniforms.deltaTime.value = dt;
        this.updateMaterial.uniforms.stiffness.value = this.stiffness;
        this.updateMaterial.uniforms.damping.value = this.damping;
        this.updateMaterial.uniforms.repulsionStrength.value = this.repulsionStrength;
        
        // 現在のバッファから読み取り、次のバッファに書き込み
        const current = this.currentBuffer;
        const next = 1 - current;
        
        this.updateMaterial.uniforms.positionTexture.value = this.positionRenderTargets[current].texture;
        this.updateMaterial.uniforms.velocityTexture.value = this.velocityRenderTargets[current].texture;
        
        // 位置を更新
        this.renderer.setRenderTarget(this.positionRenderTargets[next]);
        this.renderer.render(this.updateScene, this.updateCamera);
        
        // 速度を更新（同じシェーダーで、出力を変える）
        // NOTE: 簡略化のため、位置と速度を同じシェーダーで更新
        // 実際には別々のシェーダーが必要かもしれない
        
        // バッファを切り替え
        this.currentBuffer = next;
        
        // 描画用メッシュのuniformを更新
        const activePositionTexture = this.positionRenderTargets[this.currentBuffer].texture;
        for (const mesh of this.ribbonMeshes) {
            if (mesh.material.userData.positionTextureUniform) {
                mesh.material.userData.positionTextureUniform.value = activePositionTexture;
            }
        }
    }
    
    getMeshes() {
        return this.ribbonMeshes;
    }
    
    dispose() {
        // RenderTargetを破棄
        for (const rt of this.positionRenderTargets) {
            if (rt) rt.dispose();
        }
        for (const rt of this.velocityRenderTargets) {
            if (rt) rt.dispose();
        }
        
        // メッシュを破棄
        for (const mesh of this.ribbonMeshes) {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        }
        
        this.ribbonMeshes = [];
        this.ribbonData = [];
    }
}
