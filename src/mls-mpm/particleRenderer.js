import * as THREE from "three/webgpu";
import {Fn, attribute, triNoise3D, time, vec3, vec4, float, varying,instanceIndex,mix,normalize,cross,mat3,normalLocal,transformNormalToView,mx_hsvtorgb,mrt,uniform,fract,sin,cos,dot} from "three/tsl";
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {conf} from "../common/conf.js";


export const calcLookAtMatrix = /*#__PURE__*/ Fn( ( [ target_immutable ] ) => {
    const target = vec3( target_immutable ).toVar();
    const rr = vec3( 0,0,1.0 ).toVar();
    const ww = vec3( normalize( target ) ).toVar();
    const uu = vec3( normalize( cross( ww, rr ) ).negate() ).toVar();
    const vv = vec3( normalize( cross( uu, ww ) ).negate() ).toVar();

    return mat3( uu, vv, ww );
} ).setLayout( {
    name: 'calcLookAtMatrix',
    type: 'mat3',
    inputs: [
        { name: 'direction', type: 'vec3' },
    ]
} );

const createRoundedBox = (width, height, depth, radius) => {
    //completely overengineered late night programming lol
    const box = new THREE.BoxGeometry(width - radius*2, height - radius*2, depth - radius*2);
    const epsilon = Math.min(width, height, depth) * 0.01;
    const positionArray = box.attributes.position.array;
    const normalArray = box.attributes.normal.array;
    const indices = [...(box.getIndex().array)];
    const vertices = [];
    const posMap = {};
    const edgeMap = {};
    for (let i=0; i<positionArray.length / 3; i++) {
        const oldPosition = new THREE.Vector3(positionArray[i*3], positionArray[i*3+1], positionArray[i*3+2]);
        positionArray[i*3+0] += normalArray[i*3+0] * radius;
        positionArray[i*3+1] += normalArray[i*3+1] * radius;
        positionArray[i*3+2] += normalArray[i*3+2] * radius;
        const vertex = new THREE.Vector3(positionArray[i*3], positionArray[i*3+1], positionArray[i*3+2]);
        vertex.normal = new THREE.Vector3(normalArray[i*3], normalArray[i*3+1], normalArray[i*3+2]);
        vertex.id = i;
        vertex.faces = [];
        vertex.posHash = oldPosition.toArray().map(v => Math.round(v / epsilon)).join("_");
        posMap[vertex.posHash] = [...(posMap[vertex.posHash] || []), vertex];
        vertices.push(vertex);
    }
    vertices.forEach(vertex => {
        const face = vertex.normal.toArray().map(v => Math.round(v)).join("_");
        vertex.face = face;
        posMap[vertex.posHash].forEach(vertex => { vertex.faces.push(face); } );
    });
    vertices.forEach(vertex => {
        const addVertexToEdgeMap = (vertex, entry) => {
            edgeMap[entry] = [...(edgeMap[entry] || []), vertex];
        }
        vertex.faces.sort();
        const f0 = vertex.faces[0];
        const f1 = vertex.faces[1];
        const f2 = vertex.faces[2];
        const face = vertex.face;
        if (f0 === face || f1 === face) addVertexToEdgeMap(vertex, f0 + "_" + f1);
        if (f0 === face || f2 === face) addVertexToEdgeMap(vertex, f0 + "_" + f2);
        if (f1 === face || f2 === face) addVertexToEdgeMap(vertex, f1 + "_" + f2);
    });

    const addFace = (v0,v1,v2) => {
        const a = v1.clone().sub(v0);
        const b = v2.clone().sub(v0);
        if (a.cross(b).dot(v0) > 0) {
            indices.push(v0.id, v1.id, v2.id);
        } else {
            indices.push(v0.id, v2.id, v1.id);
        }
    }

    Object.keys(posMap).forEach(key => {
        addFace(...posMap[key])
    });

    Object.keys(edgeMap).forEach(key => {
        const edgeVertices = edgeMap[key];
        const v0 = edgeVertices[0];
        edgeVertices.sort((v1,v2) => v1.distanceTo(v0) - v2.distanceTo(v0));
        addFace(...edgeVertices.slice(0,3));
        addFace(...edgeVertices.slice(1,4));
    });

    box.setIndex(indices);
    return box;
}


class ParticleRenderer {
    mlsMpmSim = null;
    object = null;
    bloom = false;
    uniforms = {};

    constructor(mlsMpmSim) {
        this.mlsMpmSim = mlsMpmSim;

        /*const box = new THREE.BoxGeometry(0.7, 0.7,3);
        const cone = new THREE.ConeGeometry( 0.5, 3.0, 8 );
        cone.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI* 0.5, 0, 0)))
        this.geometry =  new THREE.InstancedBufferGeometry().copy(cone);
        console.log(this.geometry);*/

        const boxGeometry = BufferGeometryUtils.mergeVertices(new THREE.BoxGeometry(7, 7, 30), 3.0);
        boxGeometry.attributes.position.array = boxGeometry.attributes.position.array.map(v => v * 0.1);

        // 形状切替（すぐ戻せるようにconfで制御）
        const shape = conf.particleShape || 'roundedBox';
        let mainGeometry;
        if (shape === 'sphere') {
            // 低ポリの球：IcoSphere（頂点数を抑える）
            // NOTE: directionによる回転は見た目に出にくくなるが、負荷比較には十分
            mainGeometry = BufferGeometryUtils.mergeVertices(new THREE.IcosahedronGeometry(0.42, 0));
        } else {
            mainGeometry = createRoundedBox(0.7, 0.7, 3, 0.1);
        }

        this.defaultIndexCount = mainGeometry.index.count;
        this.shadowIndexCount = boxGeometry.index.count;

        const mergedGeometry = BufferGeometryUtils.mergeGeometries([mainGeometry, boxGeometry]);

        this.geometry = new THREE.InstancedBufferGeometry().copy(mergedGeometry);

        this.geometry.setDrawRange(0, this.defaultIndexCount);
        // 初期パーティクル数を設定（confから取得）
        this.geometry.instanceCount = conf.particles || this.mlsMpmSim.numParticles;

        // マット寄りの質感（メタリック感を抑える）
        this.material = new THREE.MeshStandardNodeMaterial({
            metalness: 0.05,
            roughness: 0.95,
            // envMapが効きすぎる場合はApp側のenvironmentIntensityを下げるのもアリ
        });

        this.uniforms.size = uniform(1);
        // phaseで「グレースケール → ヒートマップ」を線形ブレンド（0..1）
        this.uniforms.heatmapMix = uniform(1.0);
        const vAo = varying(0, "vAo");
        const vNormal = varying(vec3(0), "v_normalView");

        const particle = this.mlsMpmSim.particleBuffer.element(instanceIndex);
        this.material.positionNode = Fn(() => {
            const particlePosition = particle.get("position");
            const particleDensity = particle.get("density");
            const particleDirection = particle.get("direction");

            // 粒子ごとの固定ランダム（初期値的にずっと一定）
            const id = float(instanceIndex).toConst("pid");
            const rand1 = fract(sin(id.mul(12.9898).add(78.233)).mul(43758.5453)).toConst("prand1");
            const rand2 = fract(sin(id.mul(93.9898).add(67.345)).mul(12731.123)).toConst("prand2");
            const angle = rand1.mul(6.28318530718).toConst("pAngle"); // 2π
            const ca = cos(angle).toConst("pCA");
            const sa = sin(angle).toConst("pSA");
            // direction軸（local Z）まわりにツイストを入れる
            const rotZ = mat3(
                vec3(ca, sa, 0.0),
                vec3(sa.negate(), ca, 0.0),
                vec3(0.0, 0.0, 1.0)
            ).toConst("pRotZ");
            const sizeRand = mix(float(0.75), float(1.25), rand2).toConst("pSizeRand");

            //return attribute("position").xyz.mul(10).add(vec3(32,32,0));
            //return attribute("position").xyz.mul(0.1).add(positionAttribute.mul(vec3(1,1,0.4)));
            const mat = calcLookAtMatrix(particleDirection.xyz);
            const matTwist = mat.mul(rotZ).toConst("pMatTwist");
            vNormal.assign(transformNormalToView(matTwist.mul(normalLocal)));
            vAo.assign(particlePosition.z.div(64));
            vAo.assign(vAo.mul(vAo).oneMinus());
            return matTwist
                .mul(attribute("position").xyz.mul(this.uniforms.size).mul(sizeRand))
                .mul(particleDensity.mul(0.4).add(0.5).clamp(0,1))
                .add(particlePosition.mul(vec3(1,1,0.4)));
        })();
        // ヒートマップ色（既存）を基準に、グレースケールへ戻していく
        const heatColor = particle.get("color");
        const luma = dot(heatColor, vec3(0.299, 0.587, 0.114));
        const gray = vec3(luma);
        this.material.colorNode = mix(gray, heatColor, this.uniforms.heatmapMix);
        this.material.aoNode = vAo;

        //this.material.fragmentNode = vec4(0,0,0,1);
        //this.material.envNode = vec3(0.5);

        this.object = new THREE.Mesh(this.geometry, this.material);
        this.object.onBeforeShadow = () => { this.geometry.setDrawRange(this.defaultIndexCount, Infinity); }
        this.object.onAfterShadow = () => { this.geometry.setDrawRange(0, this.defaultIndexCount); }


        this.object.frustumCulled = false;

        const s = (1/64);
        // world transform:
        // - x: (pos.x / 64) - 0.5
        // - y: (pos.y / 64)
        // - z: (pos.z / 64) * 0.4  ※Zも中心(32)基準にオフセットして手前(負)側へ来れるようにする
        this.object.position.set(-32.0*s, 0, -32.0*s*0.4);
        this.object.scale.set(s,s,s);
        // 15万インスタンスで shadow は一気に重くなるので conf で制御（デフォOFF）
        this.object.castShadow = !!conf.particleCastShadow;
        this.object.receiveShadow = !!conf.particleReceiveShadow;
    }

    update() {
        const { particles, bloom, actualSize } = conf;
        this.uniforms.size.value = actualSize;
        this.geometry.instanceCount = particles;

        if (bloom !== this.bloom) {
            this.bloom = bloom;
            this.material.mrtNode = bloom ? mrt( {
                bloomIntensity: 1
            } ) : null;
        }

        // shadow設定は実行中に変更される可能性があるので追従
        if (this.object) {
            this.object.castShadow = !!conf.particleCastShadow;
            this.object.receiveShadow = !!conf.particleReceiveShadow;
        }
    }
}
export default ParticleRenderer;