uniform sampler2D positionTexture;
uniform sampler2D noiseOffsetTexture;  // ノイズオフセットテクスチャ（各パーティクルで異なるオフセット）
uniform float time;
uniform float noiseScale;
uniform float noiseStrength;
uniform float width;
uniform float height;
uniform float scl;
uniform vec3 terrainOffset;  // 地形のオフセット（-w/2, -h/2, 0）

// 圧力（PunchSphere）用のuniform（最大10個のsphereをサポート）
uniform int punchSphereCount;
uniform float punchSphereCenters[30];  // 10個 * 3次元 (x, y, z, x, y, z, ...)
uniform float punchSphereStrengths[10];
uniform float punchSphereRadii[10];
uniform float punchSphereReturnProbs[10];

varying vec2 vUv;

// ハッシュ関数（簡易版）
float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

// 3Dノイズ（簡易パーリンノイズ風）
float smoothNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);  // smoothstep
    
    float n = i.x + i.y * 57.0 + i.z * 113.0;
    
    float a = hash(n);
    float b = hash(n + 1.0);
    float c = hash(n + 57.0);
    float d = hash(n + 58.0);
    float e = hash(n + 113.0);
    float f1 = hash(n + 114.0);
    float g = hash(n + 170.0);
    float h = hash(n + 171.0);
    
    // 3D補間
    float x1 = mix(a, b, f.x);
    float x2 = mix(c, d, f.x);
    float y1 = mix(x1, x2, f.y);
    
    float x3 = mix(e, f1, f.x);
    float x4 = mix(g, h, f.x);
    float y2 = mix(x3, x4, f.y);
    
    return mix(y1, y2, f.z);
}

// カールノイズ関数（Processing版と完全に同じ計算方法）
vec3 curlNoise(float x, float y, float z, float t, float noiseScale, float noiseStrength) {
    float eps = 0.1;
    
    // Processing版と完全に同じ：noise((x + eps) * noiseScale + t, y * noiseScale + t, z * noiseScale + t)
    // epsは位置の差分なので、noiseScaleを掛ける前に加算（Processing版と同じ）
    float n1 = smoothNoise(vec3((x + eps) * noiseScale + t, y * noiseScale + t, z * noiseScale + t));
    float n2 = smoothNoise(vec3((x - eps) * noiseScale + t, y * noiseScale + t, z * noiseScale + t));
    float n3 = smoothNoise(vec3(x * noiseScale + t, (y + eps) * noiseScale + t, z * noiseScale + t));
    float n4 = smoothNoise(vec3(x * noiseScale + t, (y - eps) * noiseScale + t, z * noiseScale + t));
    float n5 = smoothNoise(vec3(x * noiseScale + t, y * noiseScale + t, (z + eps) * noiseScale + t));
    float n6 = smoothNoise(vec3(x * noiseScale + t, y * noiseScale + t, (z - eps) * noiseScale + t));
    
    // 勾配ベクトル（epsで正規化、Processing版と同じ）
    float dx = (n1 - n2) / (2.0 * eps);
    float dy = (n3 - n4) / (2.0 * eps);
    float dz = (n5 - n6) / (2.0 * eps);
    
    // カール（回転）を計算（Processing版と同じ）
    float curlX = dz - dy;
    float curlY = dx - dz;
    float curlZ = dy - dx;
    
    return vec3(curlX, curlY, curlZ) * noiseStrength;
}

void main() {
    // グリッド座標を計算（地形のグリッド位置）
    // UV座標をピクセル座標に変換（0.5オフセットでピクセル中心を取得）
    float gridX = floor(vUv.x * width);  // 整数のグリッド座標
    float gridY = floor(vUv.y * height);  // 整数のグリッド座標
    
    // 現在の位置を取得
    vec4 posData = texture2D(positionTexture, vUv);
    vec3 currentPos = posData.xyz;
    float baseZ = posData.w;  // 基準位置のZ（wに保存されている）
    
    // 基準位置を計算（グリッド座標から、地形の中心を画面の中心（0, 0, 0）に合わせる）
    vec3 basePos = vec3((gridX - width / 2.0) * scl, (gridY - height / 2.0) * scl, baseZ);
    
    // Scene01と同じ方法：グリッド座標（gridX, gridY）から直接ノイズを計算
    // 配列のインデックスからノイズを取得（周期的にならない）
    // ノイズオフセットテクスチャから読み取る（各パーティクルで異なる値）
    vec4 noiseOffsetData = texture2D(noiseOffsetTexture, vUv);
    float noiseOffsetX = noiseOffsetData.x;
    float noiseOffsetY = noiseOffsetData.y;
    float noiseOffsetZ = noiseOffsetData.z;
    
    // 初期状態のノイズのみを使用（動的なノイズ計算は無効化）
    // 現在の位置を基準にする（地形のオフセットを考慮）
    // currentPosは既に地形のオフセットを考慮した座標系になっている
    vec3 newPos = currentPos;
    
    // 圧力（PunchSphere）を適用
    for (int i = 0; i < 10; i++) {
        if (i >= punchSphereCount) break;
        
        // sphereの中心位置を取得（Float32Arrayからvec3に変換）
        // sphereCenterは既に地形のオフセットを考慮した座標系で渡されている
        vec3 sphereCenter = vec3(
            punchSphereCenters[i * 3],
            punchSphereCenters[i * 3 + 1],
            punchSphereCenters[i * 3 + 2]
        );
        float sphereStrength = punchSphereStrengths[i];
        float sphereRadius = punchSphereRadii[i];
        float returnProb = punchSphereReturnProbs[i];
        
        // 力が0の場合はスキップ
        if (sphereStrength < 0.01) continue;
        
        // 2D距離（X-Y平面）で事前フィルタリング
        vec2 toSphere2D = newPos.xy - sphereCenter.xy;
        float dist2DSquared = dot(toSphere2D, toSphere2D);
        float radiusSquared = sphereRadius * sphereRadius;
        
        // 2D距離が半径より大きければスキップ
        if (dist2DSquared > radiusSquared) continue;
        
        // 3D距離を計算
        vec3 toSphere = newPos - sphereCenter;
        float dist3D = length(toSphere);
        
        // 力の影響範囲内の場合
        if (dist3D < sphereRadius && dist3D > 0.1) {
            // 距離に応じた力の強さ（近いほど強い、球体状に減衰）
            float normalizedDist = dist3D / sphereRadius;
            
            // クレーター効果：底を半球状にへこませ、外周を山なりに盛り上げる
            // 凹みと盛り上がりを分離して、凹みに引っ張られないようにする
            // クレーター風に：範囲を広く浅く、盛り上がりも低めに
            
            float rimStart = 0.75;  // 縁の開始位置（半径の75%、より広い範囲で凹む）
            float centerDisplacement = 0.0;
            float rimDisplacement = 0.0;
            
            if (normalizedDist < rimStart) {
                // 中心部分：底を半球状にへこませる
                // 半球の形状：中心で最大の深さ、距離に応じて滑らかに減衰
                // sqrt(1 - (d/r)^2) のような形状で、中心が最も深く、外側に向かって滑らかに浅くなる
                float hemisphereFactor = sqrt(1.0 - (normalizedDist / rimStart) * (normalizedDist / rimStart));
                // 中心で最大の深さ、外側に向かって滑らかに減衰（半球状）
                centerDisplacement = -sphereStrength * hemisphereFactor * 2.0;
            } else {
                // 外周部分：山なりに盛り上がる（ベルカーブのような滑らかな形状）
                // 中心の凹みとは独立に、外周を押し上げる
                float rimFactor = (normalizedDist - rimStart) / (1.0 - rimStart);
                // 中心の最大凹みの体積分を計算（簡易版：最大strengthを使用）
                float maxCraterDepth = sphereStrength;
                // 山なりに盛り上がる（ベルカーブ：中心付近で最大、外側に向かって滑らかに減衰）
                // より滑らかな山なりにするため、exp(-x^2)のような形状を使用
                float bellCurve = exp(-rimFactor * rimFactor * 3.0);  // 3.0で山の幅を調整
                rimDisplacement = maxCraterDepth * bellCurve * 1.2;
            }
            
            // 力を適用（中心は凹み、外周は盛り上がる、分離して適用）
            // Z方向のみを変更（X, Y方向は格子状を保つ）
            newPos.z += centerDisplacement;  // 中心は凹む
            newPos.z += rimDisplacement;     // 外周は盛り上がる（凹みとは独立）
        }
    }
    
    // 基準位置からの距離を制限（Processing版と同じ）
    // もっとガッツリ凹ませるので、maxOffsetも大きくする
    vec3 offset = newPos - basePos;
    float distance = length(offset);
    float maxOffset = 500.0;  // 120.0 → 500.0に拡大（もっと大きく凹ませるため）
    
    // 距離がmaxOffsetに近づくほど、基準位置に戻る力を追加（滑らかに戻す）
    // Processing版と同じ：距離がmaxOffset * 0.7を超えた場合に復帰力を追加
    if (distance > maxOffset * 0.7) {
        float returnStrength = (distance - maxOffset * 0.7) / (maxOffset - maxOffset * 0.7) * 0.3;
        // 復帰確率を考慮（平均的な復帰確率を使用）
        float avgReturnProb = 0.5;  // 簡易版：平均値を使用
        returnStrength *= avgReturnProb;
        
        if (returnStrength > 0.0) {
            vec3 returnForce = -normalize(offset) * returnStrength;
            newPos += returnForce;
        }
    }
    
    // 距離がmaxOffsetを超えた場合は強制的に制限（Processing版と同じ）
    // newPosとbasePosは既に中心に合わせた座標系なので、そのまま比較
    offset = newPos - basePos;
    distance = length(offset);
    if (distance > maxOffset) {
        offset = normalize(offset) * maxOffset;
        newPos = basePos + offset;
    }
    
    // パーティクルが画面外に移動しないように、基準位置に近づける
    // 基準位置から離れすぎた場合は、基準位置に戻す（緊急時の安全装置）
    offset = newPos - basePos;
    distance = length(offset);
    if (distance > maxOffset * 1.2) {
        // 緊急時：基準位置に戻す（パーティクルが消えるのを防ぐ）
        newPos = basePos;
    }
    
    // 位置を出力（既に中心に合わせた座標系なので、そのまま出力）
    gl_FragColor = vec4(newPos, baseZ);
}

