/* @flow */

import { it, beforeEach } from 'jasmine-fix'
import * as Helpers from '../lib/helpers'
import LinterRegistry from '../lib/linter-registry'
import { getLinter, getFixturesPath } from './common'

describe('LinterRegistry', function() {
  let linterRegistry

  beforeEach(async function() {
    atom.packages.loadPackage('linter')
    atom.packages.loadPackage('language-javascript')
    linterRegistry = new LinterRegistry()
    await atom.packages.activatePackage('language-javascript')
    await atom.workspace.open(__filename)
  })
  afterEach(function() {
    linterRegistry.dispose()
    atom.workspace.destroyActivePane()
  })

  describe('life cycle', function() {
    it('works', function() {
      const linter = getLinter()
      expect(linterRegistry.hasLinter(linter)).toBe(false)
      linterRegistry.addLinter(linter)
      expect(linterRegistry.hasLinter(linter)).toBe(true)
      linterRegistry.deleteLinter(linter)
      expect(linterRegistry.hasLinter(linter)).toBe(false)
    })
    it('sets props on add', function() {
      const linter = getLinter()
      expect(typeof linter[Helpers.$version]).toBe('undefined')
      expect(typeof linter[Helpers.$requestLatest]).toBe('undefined')
      expect(typeof linter[Helpers.$requestLastReceived]).toBe('undefined')
      linterRegistry.addLinter(linter)
      expect(typeof linter[Helpers.$version]).toBe('number')
      expect(typeof linter[Helpers.$requestLatest]).toBe('number')
      expect(typeof linter[Helpers.$requestLastReceived]).toBe('number')
      expect(linter[Helpers.$version]).toBe(2)
      expect(linter[Helpers.$requestLatest]).toBe(0)
      expect(linter[Helpers.$requestLastReceived]).toBe(0)
    })
    it('sets version based on legacy param', function() {
      {
        // scenario: 2
        const linter = getLinter()
        linterRegistry.addLinter(linter)
        expect(linter[Helpers.$version]).toBe(2)
      }
      {
        // scenario: 1
        const linter = getLinter()
        linter.lintOnFly = linter.lintsOnChange
        linterRegistry.addLinter(linter, true)
        expect(linter[Helpers.$version]).toBe(1)
      }
    })
    it('deactivates the attributes on delete', function() {
      const linter = getLinter()
      linterRegistry.addLinter(linter)
      expect(linter[Helpers.$activated]).toBe(true)
      linterRegistry.deleteLinter(linter)
      expect(linter[Helpers.$activated]).toBe(false)
    })
  })
  describe('::lint', function() {
    it('does not lint if editor is not saved on disk', async function() {
      try {
        await atom.workspace.open()
        const editor = atom.workspace.getActiveTextEditor()
        expect(await linterRegistry.lint({ editor, onChange: false })).toBe(false)
      } finally {
        atom.workspace.destroyActivePane()
      }
    })
    it('does not lint if editor is ignored by VCS', async function() {
      try {
        await atom.workspace.open(getFixturesPath('ignored.txt'))
        const editor = atom.workspace.getActiveTextEditor()
        expect(await linterRegistry.lint({ editor, onChange: false })).toBe(false)
      } finally {
        atom.workspace.destroyActivePane()
      }
    })
    it('does not lint onChange if onChange is disabled by config', async function() {
      try {
        atom.config.set('linter.lintOnFly', false)
        await atom.workspace.open(getFixturesPath('file.txt'))
        const editor = atom.workspace.getActiveTextEditor()
        expect(await linterRegistry.lint({ editor, onChange: true })).toBe(false)
      } finally {
        atom.config.set('linter.lintOnFly', true)
        atom.workspace.destroyActivePane()
      }
    })
    it('lints onChange if allowed by config', async function() {
      try {
        await atom.workspace.open(getFixturesPath('file.txt'))
        const editor = atom.workspace.getActiveTextEditor()
        expect(await linterRegistry.lint({ editor, onChange: true })).toBe(true)
      } finally {
        atom.workspace.destroyActivePane()
      }
    })
    it('does not lint preview tabs if disallowed by config', async function() {
      try {
        atom.config.set('linter.lintPreviewTabs', false)
        await atom.workspace.open(getFixturesPath('file.txt'))
        const editor = atom.workspace.getActiveTextEditor()
        editor.hasTerminatedPendingState = false
        expect(await linterRegistry.lint({ editor, onChange: false })).toBe(false)
      } finally {
        atom.config.set('linter.lintPreviewTabs', true)
        atom.workspace.destroyActivePane()
      }
    })
    it('does lint preview tabs if allowed by config', async function() {
      try {
        await atom.workspace.open(getFixturesPath('file.txt'))
        const editor = atom.workspace.getActiveTextEditor()
        editor.hasTerminatedPendingState = false
        expect(await linterRegistry.lint({ editor, onChange: false })).toBe(true)
      } finally {
        atom.workspace.destroyActivePane()
      }
    })
    it('lints the editor even if its not the active one', async function() {
      try {
        await atom.workspace.open(getFixturesPath('file.txt'))
        const editor = atom.workspace.getActiveTextEditor()
        await atom.workspace.open(__filename)
        expect(await linterRegistry.lint({ editor, onChange: false })).toBe(true)
      } finally {
        atom.workspace.destroyActivePane()
      }
    })
    it('triggers providers if scopes match', async function() {
      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linterRegistry.addLinter(linter)
      spyOn(Helpers, 'shouldTriggerLinter').andCallThrough()
      spyOn(linter, 'lint').andCallThrough()
      expect(await linterRegistry.lint({ editor, onChange: false })).toBe(true)
      expect(Helpers.shouldTriggerLinter).toHaveBeenCalled()
      // $FlowIgnore: It's a magic property, duh
      expect(Helpers.shouldTriggerLinter.calls.length).toBe(1)
      expect(linter.lint).toHaveBeenCalled()
      expect(linter.lint.calls.length).toBe(1)
    })
    it('does not match if scopes dont match', async function() {
      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linter.grammarScopes = ['source.coffee']
      linterRegistry.addLinter(linter)
      spyOn(Helpers, 'shouldTriggerLinter').andCallThrough()
      spyOn(linter, 'lint').andCallThrough()
      expect(await linterRegistry.lint({ editor, onChange: false })).toBe(true)
      expect(Helpers.shouldTriggerLinter).toHaveBeenCalled()
      // $FlowIgnore: It's a magic property, duh
      expect(Helpers.shouldTriggerLinter.calls.length).toBe(1)
      expect(linter.lint).not.toHaveBeenCalled()
      expect(linter.lint.calls.length).toBe(0)
    })
    it('emits events properly', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function() {
        timesBegan++
      })
      linterRegistry.onDidFinishLinting(function() {
        timesFinished++
      })
      linterRegistry.onDidUpdateMessages(function() {
        timesUpdated++
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linterRegistry.addLinter(linter)
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(1)
      expect(timesFinished).toBe(1)
    })
    it('does not update if the buffer it was associated to was destroyed', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function() {
        timesBegan++
      })
      linterRegistry.onDidFinishLinting(function() {
        timesFinished++
      })
      linterRegistry.onDidUpdateMessages(function() {
        timesUpdated++
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linter.scope = 'file'
      linterRegistry.addLinter(linter)
      editor.destroy()
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(1)
    })
    it('does update if buffer was destroyed if its project scoped', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function() {
        timesBegan++
      })
      linterRegistry.onDidFinishLinting(function() {
        timesFinished++
      })
      linterRegistry.onDidUpdateMessages(function() {
        timesUpdated++
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linterRegistry.addLinter(linter)
      editor.destroy()
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(1)
      expect(timesFinished).toBe(1)
    })
    it('updates even if non-array response is returned', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function() {
        timesBegan++
      })
      linterRegistry.onDidFinishLinting(function() {
        timesFinished++
      })
      linterRegistry.onDidUpdateMessages(function() {
        timesUpdated++
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linterRegistry.addLinter(linter)
      linter.lint = function() { return false }
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(1)
      expect(timesFinished).toBe(1)
    })
    it('triggers the finish event even when the provider crashes', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function() {
        timesBegan++
      })
      linterRegistry.onDidFinishLinting(function() {
        timesFinished++
      })
      linterRegistry.onDidUpdateMessages(function() {
        timesUpdated++
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linterRegistry.addLinter(linter)
      linter.lint = function() { throw new Error('Boom') }
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(1)
    })
    it('gives buffer for file scoped linters on update event', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function() {
        timesBegan++
      })
      linterRegistry.onDidFinishLinting(function() {
        timesFinished++
      })
      linterRegistry.onDidUpdateMessages(function({ buffer }) {
        timesUpdated++
        expect(buffer.constructor.name).toBe('TextBuffer')
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linter.scope = 'file'
      linterRegistry.addLinter(linter)
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(1)
      expect(timesFinished).toBe(1)
    })
    it('does not give a buffer for project scoped linters on update event', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function() {
        timesBegan++
      })
      linterRegistry.onDidFinishLinting(function() {
        timesFinished++
      })
      linterRegistry.onDidUpdateMessages(function({ buffer }) {
        timesUpdated++
        expect(buffer).toBe(null)
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linterRegistry.addLinter(linter)
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(1)
      expect(timesFinished).toBe(1)
    })
    it('gives a filepath for file scoped linters on start and finish events', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function({ filePath }) {
        timesBegan++
        expect(filePath).toBe(__filename)
      })
      linterRegistry.onDidFinishLinting(function({ filePath }) {
        timesFinished++
        expect(filePath).toBe(__filename)
      })
      linterRegistry.onDidUpdateMessages(function() {
        timesUpdated++
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linter.scope = 'file'
      linterRegistry.addLinter(linter)
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(1)
      expect(timesFinished).toBe(1)
    })
    it('does not give a file path for project scoped linters on start and finish events', async function() {
      let timesBegan = 0
      let timesUpdated = 0
      let timesFinished = 0

      linterRegistry.onDidBeginLinting(function({ filePath }) {
        timesBegan++
        expect(filePath).toBe(null)
      })
      linterRegistry.onDidFinishLinting(function({ filePath }) {
        timesFinished++
        expect(filePath).toBe(null)
      })
      linterRegistry.onDidUpdateMessages(function() {
        timesUpdated++
      })

      const linter = getLinter()
      const editor = atom.workspace.getActiveTextEditor()
      linterRegistry.addLinter(linter)
      const promise = linterRegistry.lint({ editor, onChange: false })
      expect(timesBegan).toBe(1)
      expect(timesUpdated).toBe(0)
      expect(timesFinished).toBe(0)
      expect(await promise).toBe(true)
      expect(timesUpdated).toBe(1)
      expect(timesFinished).toBe(1)
    })
  })
})
