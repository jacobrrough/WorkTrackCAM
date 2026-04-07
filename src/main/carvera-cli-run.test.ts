import { describe, expect, it } from 'vitest'
import { buildCarveraUploadArgs } from './carvera-cli-run'
import type { AppSettings } from '../shared/project-schema'

const base: AppSettings = {
  theme: 'dark',
  recentProjectPaths: []
}

describe('buildCarveraUploadArgs', () => {
  it('defaults executable to carvera-cli and runs upload with local path', () => {
    const { command, args } = buildCarveraUploadArgs(base, {
      gcodePath: 'C:\\proj\\output\\cam.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    expect(command).toBe('carvera-cli')
    expect(args).toEqual([
      '--timeout',
      '60',
      'upload',
      'C:\\proj\\output\\cam.nc'
    ])
  })

  it('respects carveraCliPath and extra JSON prefix args', () => {
    const { command, args } = buildCarveraUploadArgs(
      {
        ...base,
        carveraCliPath: 'C:\\Python\\python.exe',
        carveraCliExtraArgsJson: '["-m","carvera_cli"]'
      },
      {
        gcodePath: '/tmp/out.nc',
        connection: 'wifi',
        device: '192.168.1.42',
        timeoutMs: 90_000
      }
    )
    expect(command).toBe('C:\\Python\\python.exe')
    expect(args).toEqual([
      '-m',
      'carvera_cli',
      '--wifi',
      '--device',
      '192.168.1.42',
      '--timeout',
      '90',
      'upload',
      '/tmp/out.nc'
    ])
  })

  it('adds --usb and --remote-path when set', () => {
    const { args } = buildCarveraUploadArgs(base, {
      gcodePath: 'D:\\job.nc',
      connection: 'usb',
      device: 'COM4',
      remotePath: '/sd/gcodes/job.nc',
      overwrite: true,
      timeoutMs: 120_000
    })
    expect(args).toEqual([
      '--usb',
      '--device',
      'COM4',
      '--timeout',
      '120',
      'upload',
      'D:\\job.nc',
      '--remote-path',
      '/sd/gcodes/job.nc',
      '--overwrite'
    ])
  })

  it('uses remote directory as second positional when remotePath unset', () => {
    const { args } = buildCarveraUploadArgs(base, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remoteDirectory: '/sd/gcodes/my_projects/',
      timeoutMs: 30_000
    })
    expect(args).toContain('upload')
    expect(args).toContain('/x.nc')
    expect(args).toContain('/sd/gcodes/my_projects/')
    const uploadIdx = args.indexOf('upload')
    expect(args[uploadIdx + 1]).toBe('/x.nc')
    expect(args[uploadIdx + 2]).toBe('/sd/gcodes/my_projects/')
  })

  it('prefers remotePath over remoteDirectory', () => {
    const { args } = buildCarveraUploadArgs(base, {
      gcodePath: '/a.nc',
      connection: 'auto',
      remotePath: '/sd/gcodes/a.nc',
      remoteDirectory: '/sd/ignored/',
      timeoutMs: 10_000
    })
    expect(args).toContain('--remote-path')
    expect(args).not.toContain('/sd/ignored/')
  })
})
