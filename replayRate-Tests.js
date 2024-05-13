/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const rewire = require('rewire');

const replayRateController = rewire('../../../lib/worker/rate-control/replayRateController');
const TestMessage = require('../../../lib/common/messages/testMessage');
const TransactionStatisticsCollector = require('../../../lib/common/core/transaction-statistics-collector');
const utils = require('../../../lib/common/utils/caliper-utils');

chai.use(sinonChai);
const should = chai.should();

describe('ReplayRateController', () => {
  let testMessage, stats, workerIndex, controller;

  beforeEach(() => {
    const msgContent = {
      rateControl: {
        type: 'replay',
        opts: {
          pathTemplate: '/path/to/trace/file',
          inputFormat: 'TEXT',
          defaultSleepTime: 100,
        },
      },
    };
    testMessage = new TestMessage('test', [], msgContent);
    stats = new TransactionStatisticsCollector();
    workerIndex = 0;
    controller = new replayRateController.createRateController(testMessage, stats, workerIndex);
  });

  describe('#constructor', () => {
    it('should throw an error if pathTemplate is undefined', () => {
      delete testMessage.content.rateControl.opts.pathTemplate;
      const createController = () => new replayRateController.createRateController(testMessage, stats, workerIndex);
      should.throw(createController, 'The path to load the recording from is undefined');
    });

    it('should set the default input format if not specified', () => {
      delete testMessage.content.rateControl.opts.inputFormat;
      const loggerWarnStub = sinon.stub(utils.getLogger('replay-rate-controller'), 'warn');
      controller = new replayRateController.createRateController(testMessage, stats, workerIndex);
      loggerWarnStub.should.have.been.calledWith('Input format is undefined. Defaulting to "TEXT" format');
      controller.inputFormat.should.equal('TEXT');
      loggerWarnStub.restore();
    });

    it('should set the specified input format if supported', () => {
      testMessage.content.rateControl.opts.inputFormat = 'BIN_BE';
      const loggerDebugStub = sinon.stub(utils.getLogger('replay-rate-controller'), 'debug');
      controller = new replayRateController.createRateController(testMessage, stats, workerIndex);
      loggerDebugStub.should.have.been.calledWith(`Input format is set to "BIN_BE" format in worker #${workerIndex} in round #${controller.roundIndex}`);
      controller.inputFormat.should.equal('BIN_BE');
      loggerDebugStub.restore();
    });

    it('should set the default input format if the specified format is not supported', () => {
      testMessage.content.rateControl.opts.inputFormat = 'UNSUPPORTED';
      const loggerWarnStub = sinon.stub(utils.getLogger('replay-rate-controller'), 'warn');
      controller = new replayRateController.createRateController(testMessage, stats, workerIndex);
      loggerWarnStub.should.have.been.calledWith('Input format "UNSUPPORTED" is not supported. Defaulting to "TEXT" format');
      controller.inputFormat.should.equal('TEXT');
      loggerWarnStub.restore();
    });

    it('should throw an error if the trace file does not exist', () => {
      const existsStub = sinon.stub(fs, 'existsSync').returns(false);
      const createController = () => new replayRateController.createRateController(testMessage, stats, workerIndex);
      should.throw(createController, `Trace file does not exist: ${controller.pathTemplate}`);
      existsStub.restore();
    });
  });

  describe('#applyRateControl', () => {
    const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    beforeEach(() => {
      replayRateController.__set__('Sleep', sleep);
      controller.records = [100, 200, 300];
    });

    it('should sleep if the current index is within the records', async () => {
      const now = Date.now();
      const startTimeSpy = sinon.stub(stats, 'getRoundStartTime').returns(now);
      const submitTxSpy = sinon.stub(stats, 'getTotalSubmittedTx').returns(0);

      const sleepSpy = sinon.spy(replayRateController.__get__('Sleep'));

      await controller.applyRateControl();

      sinon.assert.calledWith(sleepSpy, 100);
      startTimeSpy.restore();
      submitTxSpy.restore();
    });

    it('should not sleep if the sleep time is less than 5ms', async () => {
      const now = Date.now();
      const startTimeSpy = sinon.stub(stats, 'getRoundStartTime').returns(now - 96);
      const submitTxSpy = sinon.stub(stats, 'getTotalSubmittedTx').returns(0);

      const sleepSpy = sinon.spy(replayRateController.__get__('Sleep'));

      await controller.applyRateControl();

      sinon.assert.notCalled(sleepSpy);
      startTimeSpy.restore();
      submitTxSpy.restore();
    });

    it('should sleep with the default sleep time if the current index is out of bounds', async () => {
      const submitTxSpy = sinon.stub(stats, 'getTotalSubmittedTx').returns(3);
      const loggerWarnStub = sinon.stub(utils.getLogger('replay-rate-controller'), 'warn');

      const sleepSpy = sinon.spy(replayRateController.__get__('Sleep'));

      await controller.applyRateControl();

      sinon.assert.calledWith(sleepSpy, controller.defaultSleepTime);
      loggerWarnStub.should.have.been.calledWith(`Using default sleep time of ${controller.defaultSleepTime} ms from now on for worker #${workerIndex} in round #${controller.roundIndex}`);
      submitTxSpy.restore();
      loggerWarnStub.restore();
    });
  });
});