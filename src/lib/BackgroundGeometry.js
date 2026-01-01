import * as THREE from "three/webgpu";

class BackgroundGeometry {
    object = null;
    constructor() {
    }
    async init(params = {}) {
        const {
            size = 10,
            divisions = 40,
            centerX = 0,
            centerZ = 0,
            y = -0.05,
            // 黒背景で見えやすいデフォルトに寄せる
            colorCenter = 0xffffff,
            colorGrid = 0x666666,
            opacity = 1.0
        } = params;
        // 床（格子状ワイヤーフレーム）
        // GridHelperはXZ平面に出るので回転不要
        const grid = new THREE.GridHelper(size, divisions, colorCenter, colorGrid);
        grid.position.set(centerX, y, centerZ);
        // 黒背景で見えやすく＆Zファイトしにくく
        grid.renderOrder = -1000;
        grid.frustumCulled = false;
        // GridHelper.material は配列のことがある
        const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
        mats.forEach((m) => {
            if (!m) return;
            m.transparent = true;
            m.opacity = opacity;
            m.depthWrite = false;
        });
        // GridHelperは線なのでcastShadow/receiveShadowは基本不要
        this.floor = grid;

        this.object = new THREE.Object3D();
        this.object.add(this.floor);
    }
}
export default BackgroundGeometry;