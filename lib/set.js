
/*!
 * migrate - Set
 * Copyright (c) 2010 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var EventEmitter = require('events').EventEmitter
  , fs = require('fs')
  , path = require('path')
  , mongoose = require('mongoose');

/**
 * Expose `Set`.
 */

module.exports = Set;

/**
 * Initialize a new migration `Set` with the given `migrationPath`
 * which is used to store data between migrations.
 *
 * @param {String} migrationPath
 * @api private
 */

function Set(migrationPath) {
  this.migrations = [];
  this.migrationPath = migrationPath;
  this.pos = 0;
};

/**
 * Inherit from `EventEmitter.prototype`.
 */

Set.prototype.__proto__ = EventEmitter.prototype;

/**
 * Save the migration data and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.save = function(fn){
  if (!process.env.MIGRATION_CONFIG_PATH) 
    return fn(new Error('MIGRATION_CONFIG_PATH must be defined'))
  
  var self       = this
    , env        = process.env.NODE_ENV || 'development'
    , configPath = process.env.MIGRATION_CONFIG_PATH
    , dbUrl      = require(path.join(process.cwd(), configPath))[env]
    , db         = mongoose.createConnection(dbUrl)
    , Migration  = db.model('Migration', new mongoose.Schema({ migration: {} }));

  Migration.findOne().exec(function (err, doc) {
    if (!doc) {
      var m = new Migration({ migration: self })
      m.save(cb);
    } else {
      doc.migration = self
      doc.save(cb);
    }
  });

  function cb(err) {
    self.emit('save');
    fn && fn(err);
  }
};

/**
 * Load the migration data and call `fn(err, obj)`.
 *
 * @param {Function} fn
 * @return {Type}
 * @api public
 */

Set.prototype.load = function(fn){
  this.emit('load');

  if (!process.env.MIGRATION_CONFIG_PATH) 
    return fn(new Error('MIGRATION_CONFIG_PATH must be defined'))

  var env        = process.env.NODE_ENV || 'development'
    , configPath = process.env.MIGRATION_CONFIG_PATH
    , dbUrl      = require(path.join(process.cwd(), configPath))[env]
    , db         = mongoose.createConnection(dbUrl)
    , Migration  = db.model('Migration', new mongoose.Schema({ migration: {} }));

  Migration.findOne().exec(function (err, doc) {
    if (err) return fn(err);
    try {
      var obj = doc && doc.migration
        ? doc.migration
        : { pos: 0, migrations: [] }

      fn(null, obj);
    } catch (err) {
      fn(err);
    }
  });
};

/**
 * Run down migrations and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.down = function(fn, migrationName){
  this.migrate('down', fn, migrationName);
};

/**
 * Run up migrations and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.up = function(fn, migrationName){
  this.migrate('up', fn, migrationName);
};

/**
 * Migrate in the given `direction`, calling `fn(err)`.
 *
 * @param {String} direction
 * @param {Function} fn
 * @api public
 */

Set.prototype.migrate = function(direction, fn, migrationName){
  var self = this;
  fn = fn || function(){};
  this.load(function(err, obj){
    if (err) {
      if ('ENOENT' != err.code) return fn(err);
    } else {
      self.pos = obj.pos;
    }
    self._migrate(direction, fn, migrationName);
  });
};

/**
 * Get index of given migration in list of migrations
 *
 * @api private
 */

 function positionOfMigration(migrations, filename) {
   for(var i=0; i < migrations.length; ++i) {
     if (migrations[i].title == filename) return i;
   }
   return -1;
 }

/**
 * Perform migration.
 *
 * @api private
 */

Set.prototype._migrate = function(direction, fn, migrationName){
  var self = this
    , migrations
    , migrationPos;

  if (!migrationName) {
    migrationPos = direction == 'up' ? this.migrations.length : 0;
  } else if ((migrationPos = positionOfMigration(this.migrations, migrationName)) == -1) {
    console.error("Could not find migration: " + migrationName);
    process.exit(1);
  }

  switch (direction) {
    case 'up':
      migrations = this.migrations.slice(this.pos, migrationPos+1);
      this.pos += migrations.length;
      break;
    case 'down':
      migrations = this.migrations.slice(migrationPos, this.pos).reverse();
      this.pos -= migrations.length;
      break;
  }

  function next(err, migration) {
    // error from previous migration
    if (err) {
      self.emit('error', err);
      return fn(err);
    }

    // done
    if (!migration) {
      self.emit('complete');
      return self.save(fn);
    }

    self.emit('migration', migration, direction);
    migration[direction](function(err){
      next(err, migrations.shift());
    });
  }

  next(null, migrations.shift());
};
