import YAML from 'yaml'

export const initialDeployForm = { project: '', application: '', image: '', containerType: 'docker', command: '', args: '', restart: 'always', shell: false, instances: '1', cpus: '0.5', memory: '128', disk: '0', port: '', ports: [], volumes: '', environment: '', hostname: '', containerName: '', networkMode: '', network: '', labels: '', mesos: '', networks: '', gpus: '', ulimits: '', healthcheck: '', runtime: '', placement: '', topNetworks: '', namedVolumes: '' }

const jsonObject = (text) => { if (!text.trim()) return undefined; return JSON.parse(text) }
const textValue = (value) => value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)

export const buildComposeYaml = (form) => {
  const service = { image: form.image.trim(), command: form.command.trim() || undefined, arguments: form.args.trim() ? form.args.trim().split(/\s+/) : undefined, restart: form.restart || undefined, volumes: form.volumes.trim() ? form.volumes.split('\n').map(v => v.trim()).filter(Boolean) : undefined, environment: jsonObject(form.environment), hostname: form.hostname.trim() || undefined, container_name: form.containerName.trim() || undefined, container_type: form.containerType, shell: form.shell }
  Object.assign(service, { mesos: jsonObject(form.mesos), labels: jsonObject(form.labels), network_mode: form.networkMode.trim() || undefined, network: form.network.trim() || undefined, networks: jsonObject(form.networks), gpus: jsonObject(form.gpus), ulimits: jsonObject(form.ulimits), healthcheck: jsonObject(form.healthcheck) })
  service.deploy = { runtime: form.runtime.trim() || undefined, placement: jsonObject(form.placement), replicas: Number(form.instances), resources: { limits: { cpus: Number(form.cpus), memory: Number(form.memory) } } }
  if (form.disk !== '') service.deploy.resources.limits.disk = Number(form.disk)
  const ports = Array.isArray(form.ports) && form.ports.length ? form.ports : form.port ? form.port.split('+').map(value => value.trim()).filter(Boolean) : []
  if (ports.length) service.ports = ports.map(port => typeof port === 'string' ? port : `${port.source?.trim() ? `${port.source.trim()}:` : ''}${port.target}${port.protocol ? `/${port.protocol}` : ''}`).filter(Boolean)
  const document = { version: '3.9', services: { [form.application.trim()]: service } }
  if (form.topNetworks.trim()) document.networks = jsonObject(form.topNetworks)
  if (form.namedVolumes.trim()) document.volumes = jsonObject(form.namedVolumes)
  return YAML.stringify(document)
}

export const scaleComposeYaml = (source, serviceName, replicas) => {
  if (!Number.isInteger(replicas) || replicas < 1) throw new Error('Replicas must be a whole number greater than 0')
  const document = YAML.parse(source) || {}
  const service = document.services?.[serviceName]
  if (!service || typeof service !== 'object') throw new Error(`Service ${serviceName} was not found in the Compose YAML`)
  service.deploy = { ...(service.deploy || {}), replicas }
  return YAML.stringify(document)
}

export const formFromYaml = (source, current) => {
  const document = YAML.parse(source) || {}
  const names = Object.keys(document.services || {})
  const name = names[0] || current.application
  const service = document.services?.[name] || {}
  const limits = service.deploy?.resources?.limits || {}
  const command = Array.isArray(service.command) ? service.command : [service.command, ...(Array.isArray(service.arguments) ? service.arguments : [])].filter(Boolean)
  const portValues = Array.isArray(service.ports) ? service.ports : service.ports ? [service.ports] : []
  const ports = portValues.map(port => { const match = String(port).match(/^(?:(\d+):)?(\d+)(?:\/(tcp|udp|http|https|h2c|wss))?$/); return match ? { source: match[1] || '', target: match[2], protocol: match[3] || 'tcp' } : { source: '', target: String(port), protocol: 'tcp' } })
  return { ...current, application: name, image: textValue(service.image), containerType: service.container_type || 'docker', command: command[0] || '', args: command.slice(1).join(' '), restart: textValue(service.restart), shell: Boolean(service.shell), instances: textValue(service.deploy?.replicas ?? 1), cpus: textValue(limits.cpus ?? '0.5'), memory: textValue(limits.memory ?? '128'), disk: textValue(limits.disk ?? '0'), port: ports[0] ? `${ports[0].source ? `${ports[0].source}:` : ''}${ports[0].target}/${ports[0].protocol}` : '', ports, volumes: Array.isArray(service.volumes) ? service.volumes.join('\n') : '', environment: textValue(service.environment), hostname: textValue(service.hostname), containerName: textValue(service.container_name), mesos: textValue(service.mesos), labels: textValue(service.labels), networkMode: textValue(service.network_mode), network: textValue(service.network), networks: textValue(service.networks), gpus: textValue(service.gpus), ulimits: textValue(service.ulimits), healthcheck: textValue(service.healthcheck), runtime: textValue(service.deploy?.runtime), placement: textValue(service.deploy?.placement), topNetworks: textValue(document.networks), namedVolumes: textValue(document.volumes) }
}
