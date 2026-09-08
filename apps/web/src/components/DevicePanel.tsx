import type { DeviceInfo } from '@nebula/protocol';
import { IconLaptop, IconPhone, IconMonitor, IconCheck } from '../icons.tsx';

interface Props {
  devices: DeviceInfo[];
  activeDeviceId: string | null;
  myDeviceId: string;
  onTransfer: (deviceId: string) => void;
  onClose: () => void;
}

const iconFor = (platform: string) =>
  platform === 'mobile' ? IconPhone : platform === 'desktop' ? IconMonitor : IconLaptop;

const labelFor = (platform: string) =>
  platform === 'mobile' ? 'Celular' : platform === 'desktop' ? 'Desktop' : 'Navegador';

export function DevicePanel({ devices, activeDeviceId, myDeviceId, onTransfer, onClose }: Props) {
  const active = devices.find((d) => d.id === activeDeviceId);

  return (
    <>
      {/* Click-away layer: keeps the panel dismissable without a global listener. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={onClose} />
      <div className="device-panel">
        <div className="device-head">
          <h3>Tocando em</h3>
          <p>
            {active
              ? `Som saindo por “${active.name}”. Escolha outro aparelho para mover a reprodução sem perder o ponto da música.`
              : 'Nenhum aparelho tocando. Dê play em qualquer um — os outros viram controle remoto.'}
          </p>
        </div>

        <div className="device-list">
          {devices.map((device) => {
            const Icon = iconFor(device.platform);
            const isActive = device.id === activeDeviceId;
            return (
              <button
                key={device.id}
                className={`device-row ${isActive ? 'active' : ''}`}
                onClick={() => { if (!isActive) onTransfer(device.id); onClose(); }}
              >
                <span className="device-icon"><Icon size={20} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className="device-name truncate">
                    {device.name}
                    {device.id === myDeviceId && ' (este)'}
                  </div>
                  <div className="device-tag">
                    {labelFor(device.platform)}
                    {isActive && ' · tocando agora'}
                  </div>
                </span>
                {isActive && <IconCheck size={17} />}
              </button>
            );
          })}

          {devices.length === 0 && (
            <div className="sidebar-empty">Nenhum aparelho conectado.</div>
          )}
        </div>
      </div>
    </>
  );
}
