module.exports = {
  content: ["./*.html"],
  theme: {
    extend: {
      spacing: (() => {
        const spacing = {};
        // remベース
        for (let i = 0; i <= 200; i++) {
          const num = i / 10;
          const key = num.toString(); // 1.0 は "1" になる
          const keyFixed = num.toFixed(1); // 常に "1.0"
          spacing[key] = `${num * 0.25}rem`;
          spacing[keyFixed] = `${num * 0.25}rem`;
        }
        // pxベース
        for (let i = 0; i <= 1000; i++) {
          const num = i / 10;
          const key = `${num}px`;
          const keyFixed = `${num.toFixed(1)}px`;
          spacing[key] = `${num}px`;
          spacing[keyFixed] = `${num}px`;
        }
        return spacing;
      })(),
    },
  },
  plugins: [],
}

