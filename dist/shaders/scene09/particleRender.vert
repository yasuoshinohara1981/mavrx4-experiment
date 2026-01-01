uniform sampler2D positionTexture;
uniform sampler2D colorTexture;
uniform float width;
uniform float height;

attribute float size;
attribute vec2 particleUv;

varying vec3 vColor;
varying vec3 vPosition;
varying vec3 vNormal;

void main() {
    // 位置と色をテクスチャから取得
    float u = (floor(particleUv.x * width) + 0.5) / width;
    float v = (floor(particleUv.y * height) + 0.5) / height;
    vec2 pixelUv = vec2(u, v);
    
    vec4 posData = texture2D(positionTexture, pixelUv);
    vec4 colorData = texture2D(colorTexture, pixelUv);
    
    vec3 position = posData.xyz;
    
    // パーティクルの色をcolorTextureから取得（リキッドグラス風の色）
    vColor = colorData.rgb;
    
    vPosition = position;
    
    // メタボール用の法線を計算（球体の法線）
    // ビルボードの円を球体に見せるために法線を計算
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vec3 viewPos = mvPos.xyz;
    
    // ビルボード平面上での球体の法線を計算
    // gl_PointCoordから球体の法線を計算（後でフラグメントシェーダーで使用）
    vNormal = normalize(viewPos);  // ビュー空間での法線（後で調整）
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    
    // パーティクルサイズ（メタボール効果用、適度なサイズ）
    float pointSize = size * (400.0 / max(-mvPosition.z, 0.1));
    gl_PointSize = max(5.0, pointSize);
    gl_Position = projectionMatrix * mvPosition;
}

