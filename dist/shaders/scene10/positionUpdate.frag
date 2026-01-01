uniform sampler2D positionTexture;
uniform float time;
uniform float width;
uniform float height;
uniform float scl;
uniform float manifoldScale;
uniform float manifoldComplexity;

varying vec2 vUv;

// 簡易ノイズ関数
float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

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
    
    float x1 = mix(a, b, f.x);
    float x2 = mix(c, d, f.x);
    float y1 = mix(x1, x2, f.y);
    
    float x3 = mix(e, f1, f.x);
    float x4 = mix(g, h, f.x);
    float y2 = mix(x3, x4, f.y);
    
    return mix(y1, y2, f.z);
}

/**
 * RandomLFO: ランダムな周波数と位相で振動するLFO
 * @param t - 時間
 * @param seed - ランダムシード
 * @returns float - -1.0 ～ 1.0 の範囲の値
 */
float randomLFO(float t, float seed) {
    // ランダムな周波数（0.1 ～ 0.5 Hz）
    float freq = 0.1 + hash(seed) * 0.4;
    
    // ランダムな位相オフセット
    float phase = hash(seed * 1.5) * 6.28318;  // 0 ～ 2π
    
    // ランダムな波形の種類（sin, cos, または組み合わせ）
    float waveType = hash(seed * 2.3);
    
    float value;
    if (waveType < 0.33) {
        // sin波
        value = sin(t * freq * 6.28318 + phase);
    } else if (waveType < 0.66) {
        // cos波
        value = cos(t * freq * 6.28318 + phase);
    } else {
        // sinとcosの組み合わせ
        value = sin(t * freq * 6.28318 + phase) * cos(t * freq * 0.5 * 6.28318 + phase * 0.7);
    }
    
    // ランダムな振幅変調
    float ampMod = 0.5 + 0.5 * hash(seed * 3.7);
    value *= ampMod;
    
    return value;
}

/**
 * 複雑さ制御（30秒周期でリニアに簡単→複雑に変化）
 */
float getComplexityModulation(float t) {
    // 30秒周期（30.0秒）
    float period = 30.0;
    
    // 周期内での位置（0.0 ～ 1.0）
    float cyclePosition = mod(t, period) / period;
    
    // リニアに0.0（簡単）から1.0（複雑）に変化
    return cyclePosition;
}

/**
 * より複雑なカラビ・ヤウ多様体のパラメトリック方程式
 * RandomLFOで周期的に複雑さが変化する形状
 */
vec3 calabiYauPosition(float u, float v, float t) {
    // パラメータを拡張（円周方向と半径方向）
    float r = sqrt(u * u + v * v);
    float theta = atan(v, u);
    
    // 30秒周期でリニアに複雑さを制御（簡単→複雑）
    float complexityMod = getComplexityModulation(t);
    
    // 複雑さの範囲（0.3倍（簡単）～ 1.0倍（複雑））
    float minComplexity = 0.3;
    float maxComplexity = 1.0;
    float timeComplexity = minComplexity + (maxComplexity - minComplexity) * complexityMod;
    float dynamicComplexity = manifoldComplexity * timeComplexity;
    
    // 複数の周波数を組み合わせて複雑な形状を生成（RandomLFOで制御）
    float freq1 = dynamicComplexity * 1.0;
    float freq2 = dynamicComplexity * 2.5;
    float freq3 = dynamicComplexity * 4.0;
    // RandomLFOで高次の周波数の強度を制御
    float highFreqMod1 = getComplexityModulation(t * 0.3);
    float highFreqMod2 = getComplexityModulation(t * 0.25);
    float freq4 = dynamicComplexity * 6.0 * highFreqMod1;
    float freq5 = dynamicComplexity * 8.0 * highFreqMod2;
    
    // 時間アニメーション（複数の速度で変化、時間とともに速度も変化）
    float t1 = t * (0.3 + 0.1 * sin(t * 0.1));
    float t2 = t * (0.5 + 0.1 * cos(t * 0.12));
    float t3 = t * (0.7 + 0.1 * sin(t * 0.14));
    float t4 = t * (0.4 + 0.2 * sin(t * 0.08));
    float t5 = t * (0.6 + 0.2 * cos(t * 0.09));
    
    // ノイズを追加して有機的な形状に（RandomLFOで強度とスケールを制御、より控えめに）
    float noiseScaleMod = getComplexityModulation(t * 0.4);
    float noiseScale = 0.3 + noiseScaleMod * 0.4;  // 0.3 ～ 0.7
    float noiseStrengthMod = getComplexityModulation(t * 0.35);
    float noiseStrength = 0.08 + noiseStrengthMod * 0.12;  // 0.08 ～ 0.2（0.2～0.5から削減）
    vec3 noisePos = vec3(u * 2.0 + t1, v * 2.0 + t2, t3);
    float noiseValue = smoothNoise(noisePos * noiseScale) * noiseStrength;
    
    // 追加の高周波ノイズ（RandomLFOで制御、より控えめに）
    float highNoiseMod = getComplexityModulation(t * 0.45);
    vec3 noisePos2 = vec3(u * 3.0 + t4, v * 3.0 + t5, t * 0.5);
    float noiseValue2 = smoothNoise(noisePos2 * (noiseScale * 1.5)) * (noiseStrength * 0.5) * highNoiseMod;
    
    // 複数のsin波を組み合わせて複雑な形状を生成（RandomLFOで制御、より控えめに）
    float R1 = 1.0 + 0.15 * sin(freq1 * theta + t1);  // 0.4 → 0.15
    float R2 = 0.12 * sin(freq2 * theta + t2);  // 0.3 → 0.12
    float R3 = 0.08 * sin(freq3 * theta + t3);  // 0.2 → 0.08
    // RandomLFOで高次の項の強度を制御
    float R4Mod = getComplexityModulation(t * 0.3);
    float R5Mod = getComplexityModulation(t * 0.25);
    float R4 = 0.06 * sin(freq4 * theta + t4) * R4Mod;  // 0.15 → 0.06
    float R5 = 0.04 * sin(freq5 * theta + t5) * R5Mod;  // 0.1 → 0.04
    float R = R1 + R2 + R3 + R4 + R5 + noiseValue + noiseValue2;
    
    // phiを複雑に（RandomLFOで変形を制御、より控えめに）
    float phi = r * 3.14159265359;
    float phiMod1 = 0.12 * sin(2.0 * theta + t1);  // 0.3 → 0.12
    float phiMod2 = 0.08 * sin(3.0 * r + t2);  // 0.2 → 0.08
    // RandomLFOで高次の変形の強度を制御
    float phiMod3Mod = getComplexityModulation(t * 0.35);
    float phiMod4Mod = getComplexityModulation(t * 0.3);
    float phiMod3 = 0.06 * sin(4.0 * theta + 2.0 * r + t3) * phiMod3Mod;  // 0.15 → 0.06
    float phiMod4 = 0.04 * sin(5.0 * theta + 3.0 * r + t4) * phiMod4Mod;  // 0.1 → 0.04
    float phiMod = phi + phiMod1 + phiMod2 + phiMod3 + phiMod4;
    
    // 3D座標を計算（より対称的で回転的な形状、頭とおしりがないように）
    // 全体を回転させる（時間とともにぐるぐる回る）
    float globalRotation = t * 0.2;  // 全体の回転速度
    
    // より球対称的な形状にする（z方向の偏りを減らす）
    float x = R * cos(theta) * sin(phiMod);
    float y = R * sin(theta) * sin(phiMod);
    
    // zをより対称的に（cos(phiMod)の偏りを減らし、様々な方向にビラビラが広がるように）
    float z1 = cos(phiMod) * 0.5;  // ベースを弱める
    float z2 = 0.15 * sin(2.0 * theta + t1 + globalRotation);  // 回転を追加
    float z3 = 0.12 * cos(3.0 * r + t2 + globalRotation * 0.7);  // 回転を追加
    float z4 = 0.10 * sin(5.0 * theta + t3 + globalRotation * 1.3);  // 回転を追加
    // RandomLFOで高次の項の強度を制御
    float z5Mod = getComplexityModulation(t * 0.4);
    float z6Mod = getComplexityModulation(t * 0.35);
    float z5 = 0.08 * cos(6.0 * theta + 2.0 * r + t4 + globalRotation * 0.9) * z5Mod;  // 回転を追加
    float z6 = 0.06 * sin(7.0 * theta + 3.0 * r + t5 + globalRotation * 1.1) * z6Mod;  // 回転を追加
    
    // さらに回転的な変形を追加（角度関係なくぐるぐる回る）
    float rotMod1 = getComplexityModulation(t * 0.6);
    float rotMod2 = getComplexityModulation(t * 0.65);
    float z7 = 0.08 * sin(8.0 * theta + 4.0 * r + t * 2.0 + globalRotation * 1.5) * rotMod1;
    float z8 = 0.06 * cos(9.0 * theta + 5.0 * r + t * 2.3 + globalRotation * 1.7) * rotMod2;
    
    float z = z1 + z2 + z3 + z4 + z5 + z6 + z7 + z8;
    
    // 追加の変形（うねりを追加、RandomLFOで強度を制御、より控えめに）
    // 全体の回転を考慮して、より対称的に
    float twistMod = getComplexityModulation(t * 0.5);
    float twistStrength = 0.06 + twistMod * 0.10;  // 少し強く（0.04～0.12 → 0.06～0.16）
    float twist = twistStrength * sin(4.0 * theta + 2.0 * t + globalRotation);
    float twist2Mod = getComplexityModulation(t * 0.45);
    float twist2 = twistStrength * 0.5 * cos(5.0 * theta + 3.0 * t + globalRotation * 0.8) * twist2Mod;
    x += twist * cos(theta) + twist2 * sin(theta);
    y += twist * sin(theta) + twist2 * cos(theta);
    float zMod1 = getComplexityModulation(t * 0.4);
    float zMod2 = getComplexityModulation(t * 0.35);
    z += 0.05 * cos(6.0 * theta + 1.5 * t + globalRotation) + 0.03 * sin(8.0 * theta + 2.5 * t + globalRotation * 1.2) * zMod1;
    
    // さらに高次の変形（RandomLFOで制御、より控えめに）
    // 全体の回転を考慮して、より対称的に
    float highFreqModX = getComplexityModulation(t * 0.5);
    float highFreqModY = getComplexityModulation(t * 0.48);
    float highFreqModZ = getComplexityModulation(t * 0.46);
    float highFreqX = 0.03 * sin(9.0 * theta + 4.0 * r + t * 1.2 + globalRotation) * highFreqModX;  // 回転を追加
    float highFreqY = 0.03 * cos(10.0 * theta + 5.0 * r + t * 1.3 + globalRotation * 0.9) * highFreqModY;  // 回転を追加
    float highFreqZ = 0.03 * sin(11.0 * theta + 6.0 * r + t * 1.4 + globalRotation * 1.1) * highFreqModZ;  // 回転を追加
    
    x += highFreqX;
    y += highFreqY;
    z += highFreqZ;
    
    // 多方向へのビラビラ変形を追加（様々な方向に向かう複雑な変形、角度関係なくぐるぐる回る）
    // 異なる方向への変形を複数追加（全体の回転を考慮）
    float frillMod1 = getComplexityModulation(t * 0.6);
    float frillMod2 = getComplexityModulation(t * 0.55);
    float frillMod3 = getComplexityModulation(t * 0.65);
    
    // X方向へのビラビラ（様々な周波数と位相、回転を追加）
    float frillX1 = 0.15 * sin(7.0 * theta + 3.0 * r + t * 1.5 + globalRotation) * frillMod1;
    float frillX2 = 0.12 * cos(8.0 * theta - 2.0 * r + t * 1.3 + globalRotation * 0.8) * frillMod2;
    float frillX3 = 0.10 * sin(11.0 * theta + 5.0 * r - t * 1.7 + globalRotation * 1.2) * frillMod3;
    
    // Y方向へのビラビラ（異なるパターン、回転を追加）
    float frillY1 = 0.15 * cos(6.0 * theta - 4.0 * r + t * 1.4 + globalRotation * 0.9) * frillMod1;
    float frillY2 = 0.12 * sin(9.0 * theta + 3.0 * r - t * 1.6 + globalRotation * 1.1) * frillMod2;
    float frillY3 = 0.10 * cos(12.0 * theta - 5.0 * r + t * 1.8 + globalRotation * 1.3) * frillMod3;
    
    // Z方向へのビラビラ（さらに異なるパターン、回転を追加）
    float frillZ1 = 0.15 * sin(5.0 * theta + 6.0 * r + t * 1.2 + globalRotation * 0.7) * frillMod1;
    float frillZ2 = 0.12 * cos(10.0 * theta - 3.0 * r - t * 1.5 + globalRotation * 1.0) * frillMod2;
    float frillZ3 = 0.10 * sin(13.0 * theta + 4.0 * r + t * 1.9 + globalRotation * 1.4) * frillMod3;
    
    // 斜め方向への変形（X-Y、Y-Z、Z-X平面、回転を追加）
    float diagonalMod = getComplexityModulation(t * 0.7);
    float diagXY = 0.08 * sin(8.0 * theta + 4.0 * r + 2.0 * t + globalRotation) * diagonalMod;
    float diagYZ = 0.08 * cos(9.0 * theta - 5.0 * r + 2.3 * t + globalRotation * 0.9) * diagonalMod;
    float diagZX = 0.08 * sin(10.0 * theta + 6.0 * r - 2.1 * t + globalRotation * 1.1) * diagonalMod;
    
    // ラジアル方向への変形（中心から外側へのビラビラ、回転を追加）
    float radialMod = getComplexityModulation(t * 0.75);
    float radial1 = 0.10 * sin(6.0 * r + 3.0 * theta + t * 1.1 + globalRotation) * radialMod;
    float radial2 = 0.08 * cos(8.0 * r - 4.0 * theta + t * 1.4 + globalRotation * 0.8) * radialMod;
    
    // すべての変形を適用（多方向へのビラビラ、角度関係なくぐるぐる回る）
    x += frillX1 + frillX2 + frillX3 + diagXY + diagZX + radial1 * cos(theta);
    y += frillY1 + frillY2 + frillY3 + diagXY + diagYZ + radial1 * sin(theta);
    z += frillZ1 + frillZ2 + frillZ3 + diagYZ + diagZX + radial2;
    
    // さらに複雑な多層変形（異なるスケールでの変形を重ねる、回転を追加）
    float layerMod1 = getComplexityModulation(t * 0.8);
    float layerMod2 = getComplexityModulation(t * 0.85);
    float layer1X = 0.06 * sin(14.0 * theta + 7.0 * r + t * 2.0 + globalRotation) * layerMod1;
    float layer1Y = 0.06 * cos(15.0 * theta - 6.0 * r + t * 2.2 + globalRotation * 0.9) * layerMod1;
    float layer1Z = 0.06 * sin(16.0 * theta + 8.0 * r - t * 2.1 + globalRotation * 1.1) * layerMod1;
    
    float layer2X = 0.05 * cos(17.0 * theta - 7.0 * r + t * 2.3 + globalRotation * 0.8) * layerMod2;
    float layer2Y = 0.05 * sin(18.0 * theta + 9.0 * r - t * 2.4 + globalRotation * 1.2) * layerMod2;
    float layer2Z = 0.05 * cos(19.0 * theta - 8.0 * r + t * 2.5 + globalRotation * 1.0) * layerMod2;
    
    x += layer1X + layer2X;
    y += layer1Y + layer2Y;
    z += layer1Z + layer2Z;
    
    // 全体をさらに回転させる（角度関係なくぐるぐる回るように）
    // 3D空間での回転を追加（X、Y、Z軸周りの回転）
    float rotX = globalRotation * 0.3;
    float rotY = globalRotation * 0.5;
    float rotZ = globalRotation * 0.4;
    
    // X軸周りの回転
    float yRotated = y * cos(rotX) - z * sin(rotX);
    float zRotated = y * sin(rotX) + z * cos(rotX);
    
    // Y軸周りの回転
    float xRotated = x * cos(rotY) + zRotated * sin(rotY);
    float zRotated2 = -x * sin(rotY) + zRotated * cos(rotY);
    
    // Z軸周りの回転
    float xFinal = xRotated * cos(rotZ) - yRotated * sin(rotZ);
    float yFinal = xRotated * sin(rotZ) + yRotated * cos(rotZ);
    float zFinal = zRotated2;
    
    return vec3(xFinal, yFinal, zFinal);
    
    return vec3(x, y, z);
}

void main() {
    // グリッド座標を計算（連続的な値を使用、floor()を使わない）
    // UV座標をピクセル座標に変換（0.5オフセットでピクセル中心を取得）
    float x = (vUv.x * width) - 0.5;
    float y = (vUv.y * height) - 0.5;
    
    // 現在の位置を取得（使用しないが、テクスチャ読み込みのために必要）
    vec4 posData = texture2D(positionTexture, vUv);
    
    // パラメータ空間での座標（-1 ～ 1、連続的な値を使用）
    float u = (x / (width - 1.0)) * 2.0 - 1.0;
    float v = (y / (height - 1.0)) * 2.0 - 1.0;
    
    // カラビ・ヤウ多様体のパラメトリック方程式で位置を計算
    vec3 manifoldPos = calabiYauPosition(u, v, time);
    
    // スケールを適用
    vec3 newPos = manifoldPos * manifoldScale;
    
    // 基準位置のZを計算（初期位置、時間0.0での位置）
    vec3 basePos = calabiYauPosition(u, v, 0.0);
    float baseZ = basePos.z * manifoldScale;
    
    // 位置を出力（baseZは基準位置のZとして保存）
    // 法線計算はcolorUpdate.fragで近傍ピクセルから推定する（パフォーマンス向上）
    gl_FragColor = vec4(newPos, baseZ);
}
