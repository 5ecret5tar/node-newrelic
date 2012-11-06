'use strict';

var path    = require('path')
  , tap     = require('tap')
  , test    = tap.test
  , shimmer = require(path.join(__dirname, '..', '..', 'lib', 'shimmer'))
  , helper  = require(path.join(__dirname, '..', 'lib', 'agent_helper'))
  ;

test("MongoDB instrumentation should put DB calls in the transaction trace",
     {timeout : 5000},
     function (t) {
  t.plan(2);

  var self = this;
  helper.bootstrapMongoDB(function (error, app) {
    if (error) return t.fail(error);

    var agent = helper.loadMockedAgent();
    shimmer.bootstrapInstrumentation(agent);
    var mongodb = require('mongodb');

    var server = new mongodb.Server('localhost', 27017, {auto_reconnect : true});
    var db = new mongodb.Db('integration', server);

    self.tearDown(function () {
      db.close(true, function (error, result) {
        if (error) t.fail(error);

        helper.cleanMongoDB(app, function done() {
          helper.unloadAgent(agent);
        });
      });
    });

    t.test("with a callback", function (t) {
      t.plan(14);

      db.open(function (error, db) {
        if (error) return t.fail(error);

        db.createCollection('test', {safe : true}, function (error, collection) {
          if (error) return t.fail(error);
          t.notOk(agent.getTransaction(), "no transaction should be in play yet");

          helper.runInTransaction(agent, function transactionInScope() {
            var transaction = agent.getTransaction();
            t.ok(transaction, "transaction should be visible");

            var hunx = {id : 1, hamchunx : "verbloks"};
            collection.insert(hunx, function insertCallback(error, result) {
              if (error) return t.fail(error);

              t.ok(agent.getTransaction(), "transaction should still be visible");

              collection.findOne({id : 1}, function findOneCallback(error, item) {
                if (error) return t.fail(error);

                t.ok(agent.getTransaction(), "transaction should still still be visible");

                t.deepEquals(item, hunx, "MongoDB should still work.");

                transaction.end();

                var trace = transaction.getTrace();
                t.ok(trace, "trace should exist.");
                t.ok(trace.root, "root element should exist.");
                t.equals(trace.root.children.length, 1, "There should be only one child.");

                var insertSegment = trace.root.children[0];
                t.ok(insertSegment, "trace segment for insert should exist");
                t.equals(insertSegment.name, "MongoDB/test/insert", "should register the insert");
                t.equals(insertSegment.children.length, 1, "insert should have a child");

                var findSegment = insertSegment.children[0];
                t.ok(findSegment, "trace segment for find should exist");
                t.equals(findSegment.name, "MongoDB/test/find", "should register the find");
                t.equals(findSegment.children.length, 0, "find should leave us here at the end");

                db.close(function (error, result) {
                  if (error) t.fail(error);

                  t.end();
                });
              });
            });
          });
        });
      });
    });

    t.test("with a Cursor", function (t) {
      t.plan(1);

      db.open(function (error, db) {
        if (error) return t.fail(error);

        db.createCollection('test2', function (error, collection) {
          if (error) return t.fail(error);

          helper.runInTransaction(agent, function transactionInScope() {
            var hunx = {id : 1, hamchunx : "verbloks"};
            var insertCursor = collection.insert(hunx, function (error, result) {
              var cursor = collection.find({id : 1});
              t.ok(cursor, "cursor should be returned by callback-less find");

              t.end();
            });
          });
        });
      });
    });
  });
});