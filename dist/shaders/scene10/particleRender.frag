// レーザースキャン用uniforms（Z方向、手前から奥へスキャン）
uniform int laserScanCount;  // アクティブなレーザースキャンの数（最大10個）
uniform float laserScanPositions[10];  // スキャン位置（Z座標、正規化済み -1.0 ～ 1.0）
uniform float laserScanWidths[10];  // スキャンラインの幅
uniform float laserScanIntensities[10];  // エフェクトの強度（0.0〜1.0）
uniform float zRange;  // Z座標の範囲（正規化用）

varying vec3 vColor;
varying vec3 vPosition;  // ワールド座標

void main() {
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;
    
    vec3 finalColor = vColor;
    
    // レーザースキャンエフェクト（Z方向、手前から奥へスキャン）
    // パーティクルのZ座標を正規化（-1.0 ～ 1.0）
    float normalizedZ = vPosition.z / max(zRange, 1.0);
    
    // 全てのアクティブなレーザースキャンを処理
    // シアン（水色）で目立つように
    vec3 laserColor = vec3(0.0, 1.0, 1.0);  // シアン（水色）
    vec3 coreColor = vec3(1.0, 1.0, 1.0);   // 中心は白
    
    for (int i = 0; i < 10; i++) {
        if (i >= laserScanCount) break;
        
        // スキャンラインからの距離を計算（Z座標の差）
        float distFromScan = abs(normalizedZ - laserScanPositions[i]);
        float scanWidth = laserScanWidths[i];
        float scanIntensity = laserScanIntensities[i];
        
        // スキャンラインの範囲内かどうか
        if (distFromScan < scanWidth && scanIntensity > 0.0) {
            // スキャンラインの中心に近いほど強く
            float scanFactor = 1.0 - (distFromScan / scanWidth);
            // 滑らかに減衰
            scanFactor = smoothstep(0.0, 1.0, scanFactor);
            
            // シアンのグロー効果（強め）
            finalColor += laserColor * scanFactor * scanIntensity * 2.0;
            
            // スキャンラインの中心付近は白く光らせる
            if (distFromScan < scanWidth * 0.3) {
                float coreFactor = 1.0 - (distFromScan / (scanWidth * 0.3));
                finalColor += coreColor * coreFactor * scanIntensity * 3.0;
            }
            
            // 元の色を暗くしてコントラストを出す
            finalColor = mix(finalColor * 0.3, finalColor, scanFactor);
        }
    }
    
    // 不透明度100%（完全に不透明）
    gl_FragColor = vec4(finalColor, 1.0);
}
