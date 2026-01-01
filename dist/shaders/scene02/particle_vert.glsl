// Three.js用のバーテックスシェーダー（Scene02用）
// Processingのparticle_vert.glslをThree.js用に変換

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform vec3 cameraPosition;  // カメラの位置（被写界深度用）
uniform float sphereLife;      // スフィアの寿命（0.0-1.0、透明度制御用）
uniform vec3 sphereColor;      // スフィアの色

varying vec4 vertColor;
varying vec2 vertTexCoord;
varying float vertLife;
varying vec3 vertPosition;
varying float vertDistance;  // カメラからの距離（被写界深度用）

void main() {
    // 位置をそのまま使用
    vec4 pos = vec4(position, 1.0);
    
    // Three.jsの標準的な変換
    gl_Position = projectionMatrix * modelViewMatrix * pos;
    
    // ワールド座標での位置を保存（フラグメントシェーダーで使用）
    vertPosition = (modelViewMatrix * pos).xyz;
    
    // カメラからの距離を計算（被写界深度用）
    vertDistance = length(vertPosition - cameraPosition);
    
    // 色をuniformから取得（デフォルトは白）
    vertColor = vec4((length(sphereColor) > 0.001) ? sphereColor : vec3(1.0, 1.0, 1.0), 1.0);
    vertTexCoord = uv;
    vertLife = (sphereLife > 0.0) ? sphereLife : 1.0;  // uniformが設定されている場合はそれを使用
}

