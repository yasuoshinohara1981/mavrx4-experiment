uniform sampler2D positionTexture;
uniform float time;
uniform float noiseScale;  // 使用しないが、GPUParticleSystemが設定するため必要
uniform float noiseStrength;  // 使用しないが、GPUParticleSystemが設定するため必要
uniform float baseRadius;
uniform float width;
uniform float height;

// クレーター用uniform（一度に1つのクレーターのみ処理）
uniform int craterActive;  // クレーターがアクティブかどうか（0 or 1）
uniform float craterLatitude;
uniform float craterLongitude;
uniform float craterRadius;
uniform float craterDepth;
uniform float craterAge;

varying vec2 vUv;

// ハッシュ関数（ノイズ用）
float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

// 2Dノイズ関数（円の形状にノイズを加えるため）
float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);  // smoothstep
    
    float n = i.x + i.y * 57.0;
    
    float a = hash(n);
    float b = hash(n + 1.0);
    float c = hash(n + 57.0);
    float d = hash(n + 58.0);
    
    float x1 = mix(a, b, f.x);
    float x2 = mix(c, d, f.x);
    return mix(x1, x2, f.y);
}

void main() {
    // グリッド座標を計算（緯度・経度を復元）
    // UV座標をピクセル座標に変換（0.5オフセットでピクセル中心を取得）
    float x = (vUv.x * width) - 0.5;
    float y = (vUv.y * height) - 0.5;
    float latitude = (y / (height - 1.0) - 0.5) * 3.14159265359;
    float longitude = (x / (width - 1.0)) * 3.14159265359 * 2.0;
    
    // 現在のパーティクル位置を読み取る（前フレームの位置）
    vec4 previousPos = texture2D(positionTexture, vUv);
    vec3 currentPos = previousPos.xyz;
    float currentRadius = length(currentPos);
    
    // 初回またはエラー時は、元の緯度・経度から計算
    if (currentRadius < 0.001) {
        vec3 direction = vec3(
            cos(latitude) * cos(longitude),
            sin(latitude),
            cos(latitude) * sin(longitude)
        );
        currentPos = direction * baseRadius;
        currentRadius = baseRadius;
    }
    
    vec3 currentDir = normalize(currentPos);
    
    // クレーターがアクティブな場合、パーティクルに圧力をかける（内向きの力）
    if (craterActive > 0) {
        // クレーターの位置ベクトル（単位ベクトル）
        vec3 craterDir = vec3(
            cos(craterLatitude) * cos(craterLongitude),
            sin(craterLatitude),
            cos(craterLatitude) * sin(craterLongitude)
        );
        
        // 球面上の角度距離を計算（0 〜 PI）
        float angleDistance = acos(clamp(dot(craterDir, currentDir), -1.0, 1.0));
        
        // クレーターの半径内なら、内向きの力を加える
        // 角度距離が半径より小さい場合のみ処理（中心部から遠い位置のみ）
        if (angleDistance > 0.0 && angleDistance < craterRadius) {
            // 距離に応じた減衰（中心で最大、端で0）
            // 球体を押し付けたような浅い凹みにするため、より急激な減衰を使用
            float normalizedDistance = angleDistance / craterRadius;  // 0.0 (中心) 〜 1.0 (端)
            // 球体を押し付けたような形状：距離の2乗で急激に減衰（中心部のみ浅く凹む）
            float falloff = 1.0 - normalizedDistance;
            falloff = falloff * falloff * falloff * falloff;  // 4乗で急激に減衰（球体を押し付けたような形状）
            
            // 円の形状にノイズを加える
            // クレーター中心から見た角度を計算
            vec3 toCrater = normalize(craterDir - currentDir * dot(craterDir, currentDir));
            float angle = atan(toCrater.z, toCrater.x);
            vec2 noiseCoord = vec2(
                angle * 5.0,  // 角度方向のノイズスケール
                normalizedDistance * 8.0  // 距離方向のノイズスケール
            );
            float noiseValue = noise2D(noiseCoord);
            float noiseFactor = mix(0.7, 1.3, noiseValue);
            noiseFactor = mix(1.0, noiseFactor, falloff * 0.5);  // 中心部ではノイズを弱く
            
            // 年齢に応じて徐々に力を加える（ドン...みたいなイメージ）
            // 60フレーム（約1秒）で完全に力を加える
            float ageFactor = min(craterAge / 60.0, 1.0);  // 0.0 → 1.0
            ageFactor = 1.0 - pow(1.0 - ageFactor, 3.0);  // 3次イージング（ease-out）
            
            // 力の強さを計算（ベロシティに応じた深さ × 減衰 × 年齢 × ノイズ）
            float forceStrength = craterDepth * falloff * ageFactor * noiseFactor;
            
            // 内向きの力を適用（クレーター中心方向、つまり原点方向に移動）
            // 現在の位置から、クレーター中心方向（原点方向）に移動させる
            vec3 toCenter = -currentDir;  // 原点方向（内向き）
            currentPos += toCenter * forceStrength;
            
            // 新しい半径を計算
            currentRadius = length(currentPos);
            
            // 最小半径を設定（中心部まで届きすぎないように、baseRadiusの50%まで）
            currentRadius = max(currentRadius, baseRadius * 0.5);
            currentPos = normalize(currentPos) * currentRadius;
        }
    }
    
    // 位置を出力（baseRadiusをwに保存）
    gl_FragColor = vec4(currentPos, baseRadius);
}


