import * as dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);
const resolveTxt = promisify(dns.resolveTxt);
const resolveCname = promisify(dns.resolveCname);

export interface DnsData {
  domain: string;
  mxRecords: Array<{ exchange: string; priority: number }>;
  emailProvider: string;
  spfRecord: string;
  dmarcRecord: string;
  verificationTokens: string[];
  subdomains: string[];
  error?: string;
}

export async function collectDns(domain: string): Promise<DnsData> {
  // Strip protocol if present
  domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

  const result: DnsData = {
    domain, mxRecords: [], emailProvider: 'Unknown',
    spfRecord: '', dmarcRecord: '', verificationTokens: [], subdomains: []
  };

  try {
    // MX records
    try {
      const mx = await resolveMx(domain);
      result.mxRecords = mx.map(r => ({ exchange: r.exchange, priority: r.priority }));
      // Detect provider
      const mxStr = mx.map(r => r.exchange).join(' ').toLowerCase();
      if (mxStr.includes('google') || mxStr.includes('gmail')) { result.emailProvider = 'Google Workspace'; }
      else if (mxStr.includes('outlook') || mxStr.includes('microsoft')) { result.emailProvider = 'Microsoft 365'; }
      else if (mxStr.includes('zoho')) { result.emailProvider = 'Zoho'; }
      else if (mxStr.includes('proton')) { result.emailProvider = 'ProtonMail'; }
    } catch {}

    // TXT records (SPF, verification tokens)
    try {
      const txt = await resolveTxt(domain);
      for (const record of txt) {
        const joined = record.join('');
        if (joined.startsWith('v=spf1')) { result.spfRecord = joined; }
        if (joined.includes('google-site-verification') || joined.includes('MS=') || joined.includes('facebook-domain-verification')) {
          result.verificationTokens.push(joined);
        }
      }
    } catch {}

    // DMARC
    try {
      const dmarc = await resolveTxt('_dmarc.' + domain);
      result.dmarcRecord = dmarc.map(r => r.join('')).find(r => r.startsWith('v=DMARC1')) || '';
    } catch {}

    // Common subdomain CNAMEs
    const subdomainChecks = ['www', 'mail', 'autodiscover', 'blog', 'shop', 'app', 'api'];
    for (const sub of subdomainChecks) {
      try {
        const cname = await resolveCname(sub + '.' + domain);
        if (cname.length > 0) { result.subdomains.push(sub + '.' + domain + ' -> ' + cname[0]); }
      } catch {}
    }

  } catch (err: any) {
    result.error = err.message;
  }

  return result;
}
