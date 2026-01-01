uniform vec3 topColor;      // 中心部の色（RGB）
uniform vec3 bottomColor;    // 外側の色（RGB）
uniform float intensity;     // グラデーションの強度（0.0〜1.0）

varying vec3 vWorldPosition;

void main() {
    // ワールド座標の中心からの距離を使って放射状のグラデーションを計算
    // 中心（原点）からの距離が小さいほど明るい（topColor）、大きいほど暗い（bottomColor）
    float distance = length(vWorldPosition);
    float maxDistance = 5000.0;  // 背景Sphereの半径
    float normalizedDistance = distance / maxDistance;  // 0.0（中心）〜1.0（外側）
    
    // 中心部を明るくするため、距離を反転（0.0が中心、1.0が外側）
    float gradientFactor = 1.0 - normalizedDistance;
    gradientFactor = pow(gradientFactor, 0.3);  // グラデーションを滑らかに（明るい部分を広く）
    
    // グラデーションを計算（中心がtopColor、外側がbottomColor）
    vec3 gradientColor = mix(bottomColor, topColor, gradientFactor);
    
    // 強度を適用
    gradientColor = mix(vec3(0.0, 0.0, 0.0), gradientColor, intensity);
    
    gl_FragColor = vec4(gradientColor, 1.0);
}

