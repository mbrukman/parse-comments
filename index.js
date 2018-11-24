'use strict';

const Emitter = require('events');
const extract = require('extract-comments');
const tokenize = require('tokenize-comment');
const lib = require('./lib');
const { utils } = lib;

/**
 * Create an instance of `Comments` with the given `options`.
 *
 * ```js
 * const Comments = require('parse-comments');
 * const comments = new Comments();
 * ```
 * @name Comments
 * @extends Emitter
 * @param {Object} options
 * @api public
 */

class Comments extends Emitter {
  constructor(options) {
    super();
    this.options = Object.assign({}, options);
    this.comments = [];
    this.ast = {};
    this.cache = {
      comments: {},
      files: {},
      links: {}
    };

    this.parsers = {};
    this.tokens = [];
    this.plugins = {
      fns: [],
      middleware: {},
      before: {},
      after: {}
    };
  }

  /**
   * Register a parser function of the given `type`
   *
   * @param {string|object} `type`
   * @param {Function} `fn`
   * @return {Object}
   * @api public
   */

  parser(type, fn) {
    this.parsers[type] = fn;
    return this;
  }

  /**
   * Register a compiler plugin `fn`. Plugin functions should take an
   * options object, and return a function that takes an instance of
   * comments.
   *
   * ```js
   * // plugin example
   * function yourPlugin(options) {
   *   return function(comments) {
   *     // do stuff
   *   };
   * }
   * // usage
   * comments.use(yourPlugin());
   * ```
   *
   * @param {Function} `fn` plugin function
   * @return {Object} Returns the comments instance for chaining.
   * @api public
   */

  use(fn) {
    this.plugins.fns = this.plugins.fns.concat(fn);
    return this;
  }

  /**
   * Register a handler function to be called on a node of the given `type`.
   * Override a built-in handler `type`, or register a new type.
   *
   * ```js
   * comments.set('param', function(node) {
   *   // do stuff to node
   * });
   * ```
   * @param {String} `type` The `node.type` to call the handler on. You can override built-in middleware by registering a handler of the same name, or register a handler for rendering a new type.
   * @param {Function} `fn` The handler function
   * @return {Object} Returns the instance for chaining.
   * @api public
   */

  set(type, fn) {
    if (Array.isArray(type)) {
      for (let i = 0; i < type.length; i++) {
        this.set(type[i], fn);
      }
    } else {
      this.plugins.middleware[type] = fn;
    }
    return this;
  }

  /**
   * Register a handler that will be called by the compiler on every node
   * of the given `type`, _before other middleware are called_ on that node.
   *
   * ```js
   * comments.before('param', function(node) {
   *   // do stuff to node
   * });
   *
   * // or
   * comments.before(['param', 'returns'], function(node) {
   *   // do stuff to node
   * });
   *
   * // or
   * comments.before({
   *   param: function(node) {
   *     // do stuff to node
   *   },
   *   returns: function(node) {
   *     // do stuff to node
   *   }
   * });
   * ```
   * @param {String|Object|Array} `type` Handler name(s), or an object of middleware
   * @param {Function} `fn` Handler function, if `type` is a string or array. Otherwise this argument is ignored.
   * @return {Object} Returns the instance for chaining.
   * @api public
   */

  before(type, fn) {
    let before = this.plugins.before;
    if (utils.isObject(type)) {
      for (let key of Object.keys(type)) {
        this.before(key, type[key]);
      }
    } else if (Array.isArray(type)) {
      for (let key of type) this.before(key, fn);
    } else {
      before[type] = before[type] || [];
      before[type].push(fn);
    }
    return this;
  }

  /**
   * Register a handler that will be called by the compiler on every node
   * of the given `type`, _after other middleware are called_ on that node.
   *
   * ```js
   * comments.after('param', function(node) {
   *   // do stuff to node
   * });
   *
   * // or
   * comments.after(['param', 'returns'], function(node) {
   *   // do stuff to node
   * });
   *
   * // or
   * comments.after({
   *   param: function(node) {
   *     // do stuff to node
   *   },
   *   returns: function(node) {
   *     // do stuff to node
   *   }
   * });
   * ```
   * @param {String|Object|Array} `type` Handler name(s), or an object of middleware
   * @param {Function} `fn` Handler function, if `type` is a string or array. Otherwise this argument is ignored.
   * @return {Object} Returns the instance for chaining.
   * @api public
   */

  after(type, fn) {
    let after = this.plugins.after;
    if (utils.isObject(type)) {
      for (let key of Object.keys(type)) {
        this.after(key, type[key]);
      }
    } else if (Array.isArray(type)) {
      for (let key of type) this.after(key, fn);
    } else {
      after[type] = after[type] || [];
      after[type].push(fn);
    }
    return this;
  }

  /**
   * Run plugin functions on a node of the given `type`.
   *
   * @param {String} `type` Either `before` or `after`
   * @param {Object} `compiler` Snapdragon compiler instance
   * @return {Function} Returns a function that takes a `node`. Any plugins registered for that `node.type` will be run on the node.
   */

  run(type, compiler) {
    let plugins = this.plugins[type];

    return node => {
      let fns = plugins[node.type] || [];

      for (let fn of fns) {
        if (typeof fn !== 'function') {
          let err = new TypeError('expected plugin to be a function:' + fn);
          err.node = node;
          err.type = type;
          throw err;
        }
        node = fn.call(compiler, node) || node;
      }
      return node;
    };
  }

  /**
   * Tokenize a single javascript comment.
   *
   * ```js
   * const parser = new ParseComments();
   * const tokens = parser.tokenize([string]);
   * ```
   * @param {String} `javascript` String of javascript
   * @param {Object} `options`
   * @return {Object} Returns an object with `description` string, array of `examples`, array of `tags` (strings), and a `footer` if descriptions are defined both before and after tags.
   * @api public
   */

  tokenize(input, options) {
    let opts = Object.assign({}, this.options, options);
    // this only needs to be roughly correct. the tokenizer is smarter
    let isComment = str => /^(\s*\/\*|\*\s*@| {4,})/gm.test(str);
    if (opts.stripStars === void 0 && input && !isComment(input)) {
      opts.stripStars = false;
    }
    return tokenize(input, opts);
  }

  /**
   * Extracts and parses code comments from the given `str` of JavaScript.
   *
   * ```js
   * const parser = new ParseComments();
   * const comments = parser.parse(string);
   * ```
   * @param {String} `str` String of javascript
   * @param {Object} `options`
   * @return {Array} Array of objects.
   * @api public
   */

  parse(str, options) {
    this.ast = this.extract(str.toString(), options, comment => {
      return this.parseComment(comment, options);
    });
    return this.ast;
  }

  /**
   * Parse a single code comment.
   *
   * ```js
   * let parser = new ParseComments();
   * let comments = parser.parseComment(string);
   * ```
   * @param {String} `str` JavaScript comment
   * @param {Object} `options`
   * @return {Object} Parsed comment object
   * @api public
   */

  parseComment(comment, options) {
    let opts = Object.assign({}, this.options, options);
    let parsers = Object.assign({}, this.plugins.middleware, opts.parse);

    if (typeof parsers.comment === 'function') {
      comment = parsers.comment.call(this, comment, opts);

    } else if (typeof comment === 'string') {
      comment = this.parse.apply(this, arguments)[0];

    } else {
      let tok = this.tokenize(comment.value, opts);
      this.tokens.push(tok);

      comment = Object.assign({}, comment, tok);
      lib.normalize.examples(comment, opts);
      comment.tags = this.parseTags(comment, options);

      // let name = get(comment, 'code.context.name');
      // if (name) {
      //   set(this.cache, name, comment);
      // }
    }

    // parse inline tags
    if (comment.description) {
      let inline = this.parseInlineTags(comment.description, opts);
      comment.description = inline.value;
      comment.inlineTags = inline.tags;
    }

    // optionally format comment object
    if (opts.format === true) {
      comment = lib.format.call(this, comment, opts);
    }

    this.emit('comment', comment);
    return comment;
  }

  /**
   * Parses a single tag from a code comment. For example, each of the following
   * lines is a single tag
   *
   * ```js
   * @constructor
   * @param {String}
   * @param {String} name
   * @param {String} name The name to use for foo
   * ```
   *
   * @param {Object} tok Takes a token from
   * @return {Object}
   * @api public
   */

  parseTags(comment, options) {
    let opts = Object.assign({}, this.options, options);
    let parsers = Object.assign({}, this.plugins.middleware, opts.parse);
    let tags = [];

    if (typeof parsers.parseTags === 'function') {
      return parsers.parseTags.call(this, comment, opts);
    }

    for (let raw of comment.tags) {
      let tag = this.parseTag(raw, opts);
      if (tag) {
        utils.define(tag, 'rawType', tag.rawType);
        utils.define(tag, 'raw', raw);
        tags.push(tag);
      }
    }

    return tags;
  }

  /**
   * Parses a single tag from a code comment. For example, each of the following
   * lines is a single tag
   *
   * ```js
   * @constructor
   * @param {String}
   * @param {String} name
   * @param {String} name The name to use for foo
   * ```
   * @param {Object} tok
   * @return {Object}
   * @api public
   */

  parseTag(tok, options) {
    let opts = Object.assign({}, this.options, options);
    let parsers = Object.assign({}, this.plugins.middleware, opts.parse);
    let tag;

    if (typeof tok === 'string') {
      tok = { raw: tok, value: tok };
    }

    if (typeof parsers.tag === 'function') {
      return parsers.tag.call(this, tok.raw, opts);
    }

    try {
      tag = lib.parse.tag(tok);
    } catch (err) {
      if (opts.strict) throw err;
      return null;
    }

    if (!tag || tag.rawType && !lib.allows.type(tok)) {
      return null;
    }

    if (tag.rawType) {
      tag.type = this.parseType(tag.rawType.slice(1, -1), tag, options);
    }

    if (tag && lib.expects.type(tag) && !tag.type) {
      if (opts.strict === true) {
        return null;
      }
      tag.type = null;
    }

    tag = lib.normalize.tag(tag, opts);
    if (!tag) {
      return null;
    }

    tag = lib.validate.tag(tag, opts);
    if (!tag) {
      return null;
    }

    if (tag.description) {
      let inline = this.parseInlineTags(tag.description, opts);
      tag.description = inline.value;
      tag.inlineTags = inline.tags;
    }

    return tag;
  }

  /**
   * Parses the types from a single tag. Supports any type from jsdoc, falling
   * back on types from Google's Closure Compiler when not defined by jsdoc.
   *
   * ```js
   * @param {String}
   * @param {...string}
   * @param {function(...a)}
   * @param {function(...a:b)}
   * @param {String|Array}
   * @param {(String|Array)}
   * @param {{foo: bar}}
   * @param {String[]}
   * @param {Array<String|Function|Array>=}
   * ```
   * @param {String} value The
   * @return {Object}
   * @api public
   */

  parseInlineTags(str, options) {
    if (typeof str !== 'string') {
      throw new TypeError('expected a string');
    }

    let opts = { ...this.options, ...options };
    let parsers = { ...this.plugins.middleware, ...opts.parse };

    if (typeof parsers.inlineTag === 'function') {
      return parsers.inlineTag.call(this, str, opts);
    }

    return lib.parse.inline(str, opts);
  }

  /**
   * Parses the types from a single tag.
   *
   * ```js
   * @param {String}
   * @param {String|Array}
   * @param {(String|Array)}
   * @param {{foo: bar}}
   * ```
   * @param {string} str The string to parse
   * @return {object}
   * @api public
   */

  parseType(str, tag, options) {
    if (typeof str !== 'string') {
      throw new TypeError('expected a string');
    }

    let opts = { ...this.options, ...options };
    let parsers = { ...this.plugins.middleware, ...opts.parse };

    if (typeof parsers.type === 'function') {
      return parsers.type.call(this, str, tag, opts);
    }

    let ast = lib.parse.type(str, tag, opts);
    return ast.value;
  }

  parseParamType(str, options) {
    if (typeof str !== 'string') {
      throw new TypeError('expected a string');
    }

    let opts = { ...this.options, ...options };
    let parsers = { ...this.plugins.middleware, ...opts.parse };

    if (typeof parsers.paramType === 'function') {
      return parsers.paramType.call(this, str, opts);
    }

    return str;
  }

  decorate(name, obj) {
    let fn = this.decorators[name];
    if (typeof fn === 'function') {
      fn.call(this, obj);
    }
  }

  extract(str, options, fn) {
    if (typeof options === 'function') {
      fn = options;
      options = {};
    }

    let comments = [];
    let opts = Object.assign({}, this.options, options);
    let res = [];

    if (typeof opts.extract === 'function') {
      comments = [].concat(opts.extract.call(this, str, opts) || []);
    } else {
      comments = extract.block(str, opts);
    }

    for (let i = 0; i < comments.length; i++) {
      if (this.isValid(comments[i], options) === false) {
        continue;
      }

      let comment = this.preprocess(comments[i], options);
      if (typeof fn === 'function') {
        comment = fn.call(this, comment) || comment;
      }
      res.push(comment);
    }

    return res;
  }

  preprocess(comment, options) {
    let opts = Object.assign({}, this.options, options);

    if (typeof opts.preprocess === 'function') {
      return opts.preprocess.call(this, comment, opts);
    }

    let obj = utils.copyNode(comment);
    obj.code = utils.copyNode(comment.code);
    obj.code.context = utils.copyNode(comment.code.context);
    return obj;
  }

  /**
   * Returns true if the given `comment` is valid. By default, comments
   * are considered valid when they begin with `/**`, and do not contain
   * `jslint`, `jshint`, `eshint`, or `eslint`. A custom `isValid` function may be
   * passed on the constructor options.
   *
   * @param {Object} `comment`
   * @param {Object} `options`
   * @return {Boolean}
   * @api public
   */

  isValid(comment, options) {
    if (!utils.isObject(comment)) {
      throw new TypeError('expected comment to be an object');
    }

    let opts = Object.assign({}, this.options, options);
    if (typeof opts.isValid === 'function') {
      return opts.isValid(comment);
    }

    if (!utils.isValidBlockComment(comment, options)) {
      return false;
    }

    if (opts.protected === false && utils.isProtectedComment(comment.raw)) {
      return false;
    }

    return !utils.isConfigComment(comment.value);
  }

  static parse(str, options) {
    let comments = new Comments(options);
    return comments.parse(str);
  }

  static parseType(str, options) {
    let comments = new Comments(options);
    return comments.parseType(str);
  }
}

/**
 * Expose `Comments`
 * @type {Constructor}
 */

module.exports = Comments;
