uniform vec3 topColor;      // 中心部の色（明るいオレンジ/黄色）
uniform vec3 middleColor;   // 中部の色（オレンジ/ピンク）
uniform vec3 bottomColor;   // 外側の色（暗い青/紫）

varying vec3 vWorldPosition;

void main() {
    // ワールド座標の中心からの距離を使って放射状のグラデーションを計算
    // 中心（原点）からの距離が小さいほど明るい（topColor）、大きいほど暗い（bottomColor）
    float distance = length(vWorldPosition);
    float maxDistance = 10000.0;  // 背景Sphereの半径
    float normalizedDistance = distance / maxDistance;  // 0.0（中心）〜1.0（外側）
    
    // 朝日のグラデーション（放射状）
    // 中心（normalizedDistance < 0.3）: topColor
    // 中部（0.3 < normalizedDistance < 0.6）: middleColor
    // 外側（normalizedDistance > 0.6）: bottomColor
    vec3 gradientColor;
    if (normalizedDistance < 0.3) {
        // 中心部：topColorとmiddleColorの間を滑らかに
        float t = normalizedDistance / 0.3;  // 0.0〜1.0
        t = smoothstep(0.0, 1.0, t);
        gradientColor = mix(topColor, middleColor, t);
    } else if (normalizedDistance < 0.6) {
        // 中部：middleColorとbottomColorの間を滑らかに
        float t = (normalizedDistance - 0.3) / 0.3;  // 0.0〜1.0
        t = smoothstep(0.0, 1.0, t);
        gradientColor = mix(middleColor, bottomColor, t);
    } else {
        // 外側：bottomColor
        float t = (normalizedDistance - 0.6) / 0.4;  // 0.0〜1.0
        t = smoothstep(0.0, 1.0, t);
        gradientColor = mix(bottomColor, bottomColor * 0.5, t);  // さらに暗く
    }
    
    gl_FragColor = vec4(gradientColor, 1.0);
}

