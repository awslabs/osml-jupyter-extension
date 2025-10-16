module.exports = {
  module: {
    rules: [
      // Add rule to handle Python files as raw text
      {
        test: /\.py$/,
        use: 'raw-loader'
      }
    ]
  }
};
