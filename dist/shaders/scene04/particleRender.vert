uniform sampler2D positionTexture;
uniform sampler2D colorTexture;
uniform float width;
uniform float height;

attribute float size;
attribute vec2 particleUv;

varying vec3 vColor;

void main() {
    // 位置と色をテクスチャから取得
    float u = (floor(particleUv.x * width) + 0.5) / width;
    float v = (floor(particleUv.y * height) + 0.5) / height;
    vec2 pixelUv = vec2(u, v);
    
    vec4 posData = texture2D(positionTexture, pixelUv);
    vec4 colorData = texture2D(colorTexture, pixelUv);
    
    vec3 position = posData.xyz;
    vColor = colorData.rgb;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    
    float pointSize = size * (300.0 / -mvPosition.z);
    gl_PointSize = max(1.0, pointSize);
    gl_Position = projectionMatrix * mvPosition;
}

