uniform float baseRadius;  // 球体のベース半径
uniform int laserScanCount;  // アクティブなレーザースキャンの数（最大10個）
uniform float laserScanPositions[10];  // スキャン位置（緯度、-PI/2 = 下、PI/2 = 上）
uniform float laserScanWidths[10];  // スキャンラインの幅（緯度の範囲、ラジアン）
uniform float laserScanIntensities[10];  // エフェクトの強度（0.0〜1.0）

varying vec3 vColor;
varying vec3 vPosition;
varying vec3 vNormal;

void main() {
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;
    
    // ビルボードの円をsphereに見せるために法線を計算
    // gl_PointCoordから円の中心への方向を計算
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distFromCenter = length(coord);
    
    // 円の中心からの距離を使って、球体の法線を計算
    // z = sqrt(1.0 - x^2 - y^2) で球体の表面のz座標を計算
    float z = sqrt(max(0.0, 1.0 - distFromCenter * distFromCenter * 4.0));
    vec3 sphereNormal = normalize(vec3(coord * 2.0, z));
    
    // ビルボードの法線を計算（ビュー空間での法線）
    // vNormalはカメラ方向（ビュー空間、正規化済み）
    // ビルボード平面上での球体の法線を、ビュー空間の法線に変換
    vec3 viewDir = normalize(vNormal);  // カメラ方向（ビュー空間、正規化済み）
    
    // ビルボード平面上の任意の2つの直交ベクトルを生成
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(up, viewDir));
    vec3 upCorrected = cross(viewDir, right);
    
    // ビルボード平面上の球体の法線を、ビュー空間の法線に変換
    vec3 normal = normalize(viewDir * sphereNormal.z + right * sphereNormal.x + upCorrected * sphereNormal.y);
    
    // ライティング計算（Processingと同じ）
    // 左からのライト（Processingと同じ：directionalLight(255, 255, 255, -1, 0, 0)）
    vec3 lightDir = normalize(vec3(-1.0, 0.0, 0.0));  // 左からのライト
    float NdotL = max(dot(normal, lightDir), 0.0);
    
    // 環境光（Processingと同じ：ambientLight(63, 31, 31)）
    vec3 ambient = vec3(0.247, 0.122, 0.122);  // 63/255, 31/255, 31/255
    
    // 拡散反射（Processingと同じ：directionalLight(255, 255, 255, -1, 0, 0)）
    vec3 diffuse = vec3(1.0, 1.0, 1.0) * NdotL * 0.8;
    
    // オレンジ色のライト（Processingと同じ：directionalLight(255, 165, 0, 0.3, -0.8, -0.5)）
    vec3 orangeLightDir = normalize(vec3(0.3, -0.8, -0.5));
    float NdotL2 = max(dot(normal, orangeLightDir), 0.0);
    vec3 orangeDiffuse = vec3(1.0, 0.647, 0.0) * NdotL2 * 0.8;  // 255/255, 165/255, 0/255
    
    // 最終的な色を計算（明るさをさらに上げる）
    vec3 finalColor = vColor * (ambient + diffuse + orangeDiffuse) * 2.5;  // 明るさを2.5倍に
    
    // レーザースキャンエフェクト（球体の表面を下から上にスキャン、緯度ベース、ポリフォニック対応）
    // Processing版と同じ：緯度ベースでスキャン
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
    
    // 完全に不透明にする（DOFエフェクトは無効化）
    gl_FragColor = vec4(finalColor, 1.0);
}

