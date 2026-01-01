uniform float baseRadius;  // 球体のベース半径
uniform int laserScanCount;  // アクティブなレーザースキャンの数（最大10個）
uniform float laserScanPositions[10];  // スキャン位置（緯度、-PI/2 = 下、PI/2 = 上）
uniform float laserScanWidths[10];  // スキャンラインの幅（緯度の範囲、ラジアン）
uniform float laserScanIntensities[10];  // エフェクトの強度（0.0〜1.0）

varying vec3 vColor;
varying vec3 vPosition;

void main() {
    // 透明度220（Processingと同じ）
    float alpha = 220.0 / 255.0;
    
    vec3 finalColor = vColor;
    
    // レーザースキャンエフェクト（球体の表面を下から上にスキャン、緯度ベース、ポリフォニック対応）
    // パーティクルの位置から緯度を計算
    float particleLatitude = asin(clamp(vPosition.y / baseRadius, -1.0, 1.0));
    
    // 全てのアクティブなレーザースキャンを処理
    vec3 laserColor = vec3(1.0, 0.0, 0.0);  // 赤色
    for (int i = 0; i < 10; i++) {
        if (i >= laserScanCount) break;
        
        // スキャンラインからの距離を計算（緯度の差）
        float distFromScan = abs(particleLatitude - laserScanPositions[i]);
        float scanWidth = laserScanWidths[i];
        float scanIntensity = laserScanIntensities[i];
        
        // スキャンラインの範囲内かどうか
        if (distFromScan < scanWidth && scanIntensity > 0.0) {
            // スキャンラインの中心に近いほど強く
            float scanFactor = 1.0 - (distFromScan / scanWidth);
            // 滑らかに減衰
            scanFactor = smoothstep(0.0, 1.0, scanFactor);
            
            // 赤いレーザーの色を追加（加算ブレンド）
            finalColor += laserColor * scanFactor * scanIntensity;
            
            // スキャンラインの中心付近で少し明るくする
            if (distFromScan < scanWidth * 0.5) {
                finalColor += laserColor * scanFactor * scanIntensity * 0.5;
            }
        }
    }
    
    gl_FragColor = vec4(finalColor, alpha);
}

