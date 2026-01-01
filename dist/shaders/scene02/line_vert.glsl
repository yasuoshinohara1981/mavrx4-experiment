// Three.js用のバーテックスシェーダー（Scene02用、線描画）
// Processingのline_vert.glslをThree.js用に変換

attribute vec3 position;
attribute vec3 color;
attribute vec2 uv;

uniform vec3 cameraPosition;  // カメラの位置（被写界深度用）

varying vec4 vertColor;
varying vec2 vertTexCoord;
varying float vertLife;
varying vec3 vertPosition;
varying float vertDistance;  // カメラからの距離（被写界深度用）

void main() {
    vec4 pos = vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * pos;
    
    // ワールド座標での位置を保存（フラグメントシェーダーで使用）
    vertPosition = (modelViewMatrix * pos).xyz;
    
    // カメラからの距離を計算（被写界深度用）
    vertDistance = length(vertPosition - cameraPosition);
    
    vertColor = vec4(color, 1.0);
    vertTexCoord = uv;
    vertLife = 1.0;
}

