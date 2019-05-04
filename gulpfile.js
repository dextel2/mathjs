// @ts-nocheck
const fs = require('fs')
const path = require('path')
const gulp = require('gulp')
const log = require('fancy-log')
const webpack = require('webpack')
const babel = require('gulp-babel')
const uglify = require('uglify-js')
const docgenerator = require('./tools/docgenerator')
const entryGenerator = require('./tools/entryGenerator')
const validateAsciiChars = require('./tools/validateAsciiChars')

const ENTRY = './src/entry/bundleAny.js'
const HEADER = './src/header.js'
const VERSION = './src/version.js'
const COMPILE_SRC = './src/**/*.js'
const COMPILE_LIB = './lib'
const COMPILED_MAIN_ANY = './lib/entry/mainAny.js'
const FILE = 'math.js'
const FILE_MIN = 'math.min.js'
const FILE_MAP = 'math.min.map'
const DIST = path.join(__dirname, '/dist')
const REF_SRC = './lib/'
const REF_DEST = './docs/reference/functions'
const REF_ROOT = './docs/reference'
const MATH_JS = DIST + '/' + FILE
const COMPILED_HEADER = COMPILE_LIB + '/header.js'

// read the version number from package.json
function getVersion () {
  return JSON.parse(String(fs.readFileSync('./package.json'))).version
}

// generate banner with today's date and correct version
function createBanner () {
  const today = new Date().toISOString().substr(0, 10) // today, formatted as yyyy-mm-dd
  const version = getVersion()

  return String(fs.readFileSync(HEADER))
    .replace('@@date', today)
    .replace('@@version', version)
}

// generate a js file containing the version number
function updateVersionFile () {
  const version = getVersion()

  fs.writeFileSync(VERSION, 'export const version = \'' + version + '\'\n' +
    '// Note: This file is automatically generated when building math.js.\n' +
    '// Changes made in this file will be overwritten.\n')
}

const bannerPlugin = new webpack.BannerPlugin({
  banner: createBanner(),
  entryOnly: true,
  raw: true
})

const webpackConfig = {
  entry: ENTRY,
  mode: 'production',
  performance: { hints: false }, // to hide the "asset size limit" warning
  output: {
    library: 'math',
    libraryTarget: 'umd',
    path: DIST,
    globalObject: 'this',
    filename: FILE
  },
  externals: [
    'crypto' // is referenced by decimal.js
  ],
  plugins: [
    bannerPlugin
    // new webpack.optimize.ModuleConcatenationPlugin()
    // TODO: ModuleConcatenationPlugin seems not to work. https://medium.com/webpack/webpack-3-official-release-15fd2dd8f07b
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: 'babel-loader'
      }
    ]
  },
  optimization: {
    minimize: false
  },
  cache: true
}

const uglifyConfig = {
  sourceMap: {
    filename: FILE,
    url: FILE_MAP
  },
  output: {
    comments: /@license/
  }
}

// create a single instance of the compiler to allow caching
const compiler = webpack(webpackConfig)

function bundle (done) {
  // update the banner contents (has a date in it which should stay up to date)
  bannerPlugin.banner = createBanner()

  updateVersionFile()

  compiler.run(function (err, stats) {
    if (err) {
      log(err)
      done(err)
    }
    const info = stats.toJson()

    if (stats.hasWarnings()) {
      log('Webpack warnings:\n' + info.warnings.join('\n'))
    }

    if (stats.hasErrors()) {
      log('Webpack errors:\n' + info.errors.join('\n'))
      done(new Error('Compile failed'))
    }

    log('bundled ' + MATH_JS)

    done()
  })
}

function compile () {
  return gulp.src(COMPILE_SRC)
    .pipe(babel())
    .pipe(gulp.dest(COMPILE_LIB))
}
function writeBanner (cb) {
  fs.writeFileSync(COMPILED_HEADER, createBanner())
  cb()
}

function minify (done) {
  const oldCwd = process.cwd()
  process.chdir(DIST)

  try {
    const result = uglify.minify({
      'math.js': fs.readFileSync(FILE, 'utf8')
    }, uglifyConfig)

    if (result.error) {
      throw result.error
    }

    fs.writeFileSync(FILE_MIN, result.code)
    fs.writeFileSync(FILE_MAP, result.map)

    log('Minified ' + FILE_MIN)
    log('Mapped ' + FILE_MAP)
  } catch (e) {
    throw e
  } finally {
    process.chdir(oldCwd)
  }

  done()
}

function validate (done) {
  const childProcess = require('child_process')

  // this is run in a separate process as the modules need to be reloaded
  // with every validation (and required modules stay in cache).
  childProcess.execFile('node', ['./tools/validateEmbeddedDocs'], function (err, stdout, stderr) {
    if (err instanceof Error) {
      throw err
    }
    process.stdout.write(stdout)
    process.stderr.write(stderr)

    done()
  })
}

function validateAscii (done) {
  const Reset = '\x1b[0m'
  const BgRed = '\x1b[41m'

  validateAsciiChars.getAllFiles('./src')
    .map(validateAsciiChars.validateChars)
    .forEach(function (invalidChars) {
      invalidChars.forEach(function (res) {
        console.log(res.insideComment ? '' : BgRed,
          'file:', res.filename,
          'ln:' + res.ln,
          'col:' + res.col,
          'inside comment:', res.insideComment,
          'code:', res.c,
          'character:', String.fromCharCode(res.c),
          Reset
        )
      })
    })

  done()
}

function generateDocs (done) {
  const all = require(REF_SRC + 'entry/bundleAny')
  const functionNames = Object.keys(all)
    .filter(key => typeof all[key] === 'function')

  docgenerator.iteratePath(functionNames, REF_SRC, REF_DEST, REF_ROOT)

  done()
}

function generateEntryFiles (done) {
  entryGenerator.generateEntryFiles()

  done()
}

// Add links to deprecated functions in the node.js transpiled code mainAny.js
// These names are not valid in ES6 where we use them as functions instead of properties.
function addDeprecatedFunctions (done) {
  const code = String(fs.readFileSync(COMPILED_MAIN_ANY))

  const updatedCode = code + '\n\n' +
    'exports[\'var\'] = exports.deprecatedVar;\n' +
    'exports[\'typeof\'] = exports.deprecatedTypeof;\n' +
    'exports[\'eval\'] = exports.deprecatedEval;\n' +
    'exports[\'import\'] = exports.deprecatedImport;\n'

  fs.writeFileSync(COMPILED_MAIN_ANY, updatedCode)

  log('Added deprecated functions to ' + COMPILED_MAIN_ANY)

  done()
}

// check whether any of the source files contains non-ascii characters
gulp.task('validate:ascii', validateAscii)

// The watch task (to automatically rebuild when the source code changes)
// Does only generate math.js, not the minified math.min.js
gulp.task('watch', function watch () {
  const files = ['package.json', 'number.js.js', 'src/**/*.js']
  const options = {
    // ignore version.js else we get an infinite loop since it's updated during bundle
    ignored: /version\.js/,
    ignoreInitial: false,
    delay: 100
  }

  gulp.watch(files, options, gulp.parallel(bundle, compile, addDeprecatedFunctions))
})

// The default task (called when you run `gulp`)
gulp.task('default', gulp.series(
  bundle,
  compile,
  writeBanner,
  generateEntryFiles,
  addDeprecatedFunctions,
  minify,
  validate,
  generateDocs
))
