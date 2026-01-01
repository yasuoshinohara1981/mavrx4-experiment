varying vec3 vColor;

void main() {
    // 透明度220（Processingと同じ）
    float alpha = 220.0 / 255.0;
    
    gl_FragColor = vec4(vColor, alpha);
}

