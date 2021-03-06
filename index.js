const flow = require("lodash.flow");

const addBundleVisualizer = (options = {}, behindFlag = false) => config => {
  const BundleAnalyzerPlugin = require("webpack-bundle-analyzer")
    .BundleAnalyzerPlugin;

  // if behindFlag is set to true, the report will be created only if
  // the `--analyze` flag is added to the `yarn build` command
  if (behindFlag ? process.argv.includes("--analyze") : true) {
    config.plugins.push(
      new BundleAnalyzerPlugin(
        Object.assign(
          {
            analyzerMode: "static",
            reportFilename: "report.html"
          },
          options
        )
      )
    );
  }
  return config;
};

const getBabelLoader = config => {
  const babelLoaderFilter = rule =>
    rule.loader &&
    rule.loader.includes("babel") &&
    rule.options &&
    rule.options.plugins;

  // First, try to find the babel loader inside the oneOf array.
  // This is where we can find it when working with react-scripts@2.0.3.
  let loaders = config.module.rules.find(rule => Array.isArray(rule.oneOf))
    .oneOf;

  let babelLoader = loaders.find(babelLoaderFilter);

  // If the loader was not found, try to find it inside of the "use" array, within the rules.
  // This should work when dealing with react-scripts@2.0.0.next.* versions.
  if (!babelLoader) {
    loaders = loaders.reduce((ldrs, rule) => ldrs.concat(rule.use || []), []);
    babelLoader = loaders.find(babelLoaderFilter);
  }
  return babelLoader;
}

const addBabelPlugin = plugin => config => {
  getBabelLoader(config).options.plugins.push(plugin);
  return config;
};

const addBabelPreset = preset => config => {
  getBabelLoader(config).options.presets.push(preset);
  return config;
};

const addDecoratorsLegacy = () => config =>
  addBabelPlugin(["@babel/plugin-proposal-decorators", { legacy: true }])(
    config
  );

const disableEsLint = () => config => {
  let eslintRules = config.module.rules.filter(
    r => r.use && r.use.some(u => u.options && u.options.useEslintrc !== void 0)
  );
  eslintRules.forEach(rule => {
    config.module.rules = config.module.rules.filter(r => r !== rule);
  });
  return config;
};

const addWebpackAlias = alias => config => {
  if (!config.resolve) {
    config.resolve = {};
  }
  if (!config.resolve.alias) {
    config.resolve.alias = {};
  }
  Object.assign(config.resolve.alias, alias);
  return config;
};

const adjustWorkbox = adjust => config => {
  config.plugins.forEach(p => {
    if (p.constructor.name === "GenerateSW") {
      adjust(p.config);
    }
  });
  return config;
};

const useEslintRc = () => config => {
  const eslintRule = config.module.rules.filter(
    r => r.use && r.use.some(u => u.options && u.options.useEslintrc !== void 0)
  )[0];

  eslintRule.use[0].options.useEslintrc = true;
  eslintRule.use[0].options.ignore = true;
  delete eslintRule.use[0].options.baseConfig;

  const rules = config.module.rules.map(r =>
    r.use && r.use.some(u => u.options && u.options.useEslintrc !== void 0)
      ? eslintRule
      : r
  );
  config.module.rules = rules;

  return config;
};

const enableEslintTypescript = () => config => {
  const eslintRule = config.module.rules.filter(
    r => r.use && r.use.some(u => u.options && u.options.useEslintrc !== void 0)
  )[0];

  eslintRule.test = /\.([j,t]sx?|mjs)$/;

  const rules = config.module.rules.map(r =>
    r.use && r.use.some(u => u.options && u.options.useEslintrc !== void 0)
      ? eslintRule
      : r
  );
  config.module.rules = rules;

  return config;
};

const useBabelRc = () => config => {
  getBabelLoader(config).options.babelrc = true;
  return config;
};

const babelInclude = include => config => {
  getBabelLoader(config).include = include;
  return config;
};

const override = (...plugins) => flow(...plugins.filter(f => f));

const addBabelPlugins = (...plugins) => plugins.map(p => addBabelPlugin(p));

const addBabelPresets = (...plugins) => plugins.map(p => addBabelPreset(p));

const fixBabelImports = (libraryName, options) =>
  addBabelPlugin([
    "import",
    Object.assign(
      {},
      {
        libraryName
      },
      options
    ),
    `fix-${libraryName}-imports`
  ]);

const addLessLoader = (loaderOptions = {}) => config => {
  const mode = process.env.NODE_ENV === "development" ? "dev" : "prod";

  // Need these for production mode, which are copied from react-scripts
  const publicPath = require("react-scripts/config/paths").servedPath;
  const shouldUseRelativeAssetPaths = publicPath === "./";
  const shouldUseSourceMap =
    mode === "prod" && process.env.GENERATE_SOURCEMAP !== "false";

  const lessLoader = [
    mode === "dev"
      ? require.resolve("style-loader")
      : {
          loader: require("mini-css-extract-plugin").loader,
          options: Object.assign(
            {},
            shouldUseRelativeAssetPaths ? { publicPath: "../../" } : undefined
          )
        },
    {
      loader: require.resolve("css-loader"),
      options: { importLoaders: 2 }
    },
    {
      loader: require.resolve("postcss-loader"),
      options: {
        ident: "postcss",
        plugins: () => [
          require("postcss-flexbugs-fixes"),
          require("postcss-preset-env")({
            autoprefixer: {
              flexbox: "no-2009"
            },
            stage: 3
          })
        ],
        sourceMap: shouldUseSourceMap
      }
    },
    {
      loader: require.resolve("less-loader"),
      options: Object.assign(loaderOptions, {
        source: shouldUseSourceMap
      })
    }
  ];

  const loaders = config.module.rules.find(rule => Array.isArray(rule.oneOf))
    .oneOf;

  // Insert less-loader as the penultimate item of loaders (before file-loader)
  loaders.splice(loaders.length - 1, 0, {
    test: /\.less$/,
    use: lessLoader,
    sideEffects: mode === "prod"
  });

  return config;
};

// Use this helper to override the webpack dev server settings
//  it works just like the `override` utility
const overrideDevServer = (...plugins) => configFunction => (
  proxy,
  allowedHost
) => {
  const config = configFunction(proxy, allowedHost);
  const updatedConfig = override(...plugins)(config);
  return updatedConfig;
};

// to be used inside `overrideDevServer`, makes CRA watch all the folders
// included `node_modules`, useful when you are working with linked packages
// usage: `yarn start --watch-all`
const watchAll = () => config => {
  if (process.argv.includes("--watch-all")) {
    delete config.watchOptions;
  }
  return config;
};

// to be used to disable chunk according to:
// https://github.com/facebook/create-react-app/issues/5306#issuecomment-433425838
const disableChunk = () => config => {
  config.optimization.splitChunks = {
    cacheGroups: {
        default: false,
    },
  };

  config.optimization.runtimeChunk = false;

  return config;
};

module.exports = {
  override,
  addBundleVisualizer,
  addBabelPlugin,
  addDecoratorsLegacy,
  disableEsLint,
  addWebpackAlias,
  adjustWorkbox,
  useEslintRc,
  enableEslintTypescript,
  addBabelPlugins,
  fixBabelImports,
  useBabelRc,
  addLessLoader,
  overrideDevServer,
  watchAll,
  babelInclude,
  addBabelPreset,
  addBabelPresets,
  disableChunk
};
