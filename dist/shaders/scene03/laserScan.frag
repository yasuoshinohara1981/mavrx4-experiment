uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float scanPosition;  // スキャン位置（0.0 = 下、1.0 = 上）
uniform float scanWidth;  // スキャンラインの幅（0.0〜1.0）
uniform float intensity;  // エフェクトの強度（0.0〜1.0）

varying vec2 vUv;

void main() {
    vec2 uv = vUv;
    
    // 元の色を取得
    vec4 originalColor = texture2D(tDiffuse, uv);
    
    // スキャンラインの位置を計算（下から上へ）
    float scanY = 1.0 - scanPosition;  // 下から上へ（0.0 = 下、1.0 = 上）
    
    // 現在のピクセルのY座標（0.0 = 下、1.0 = 上）
    float pixelY = uv.y;
    
    // スキャンラインからの距離を計算
    float distFromScan = abs(pixelY - scanY);
    
    // スキャンラインの範囲内かどうか
    float scanFactor = 0.0;
    if (distFromScan < scanWidth) {
        // スキャンラインの中心に近いほど強く
        scanFactor = 1.0 - (distFromScan / scanWidth);
        // 滑らかに減衰
        scanFactor = smoothstep(0.0, 1.0, scanFactor);
    }
    
    // 赤いレーザーの色を計算
    vec3 laserColor = vec3(1.0, 0.0, 0.0);  // 赤色
    float laserAlpha = scanFactor * intensity;
    
    // 元の色にレーザーを合成（加算ブレンド）
    vec3 finalColor = originalColor.rgb + laserColor * laserAlpha;
    
    // スキャンラインの中心付近で少し明るくする
    if (distFromScan < scanWidth * 0.5) {
        finalColor += laserColor * laserAlpha * 0.5;
    }
    
    gl_FragColor = vec4(finalColor, originalColor.a);
}

