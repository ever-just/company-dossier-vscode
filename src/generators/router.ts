import * as fs from 'fs';
import * as path from 'path';
import { writeFile, todayISO } from '../utils';

const SECTIONS = [
  '1_corporate', '2_people', '3_products', '4_suppliers', '5_customers',
  '6_competitors', '7_financials', '8_marketing', '9_brand', '10_timeline',
  '11_analysis', '12_industry'
];

const SECTION_QUESTIONS: Record<string, string[]> = {
  '1_corporate': ['What is their legal name?', 'Where are they located?', 'What certifications do they hold?', 'What is their tech stack?'],
  '2_people': ['Who is the CEO?', 'How many employees?', 'Who has left?', 'Who was recently hired?'],
  '3_products': ['What do they sell?', 'What are their prices?', 'Do they have branded products?'],
  '4_suppliers': ['Who are their suppliers?', 'Are partnerships verified?', 'What is their supply chain risk?'],
  '5_customers': ['Who are their clients?', 'What markets do they target?', 'What testimonials exist?'],
  '6_competitors': ['Who competes with them?', 'How do they compare?', 'What is the biggest threat?'],
  '7_financials': ['What is their revenue?', 'What is the company worth?', 'What are the financial signals?'],
  '8_marketing': ['How do they market?', 'What events do they attend?', 'What is their social media presence?'],
  '9_brand': ['What is their brand identity?', 'What does their name mean?'],
  '10_timeline': ['When were they founded?', 'What are the key milestones?'],
  '11_analysis': ['What are the top risks?', 'Should someone acquire them?', 'What is the SWOT?'],
  '12_industry': ['How big is the market?', 'What regulations apply?', 'What technology trends matter?'],
};

export function generateRouter(dossierDir: string, companyName: string): void {
  const lines: string[] = [
    '---', 'title: "Question Router"', 'type: reference', `last_updated: ${todayISO()}`, '---', '',
    '# Question Router', '',
    '> **For AI agents:** Read this file first. Find the question closest to yours. Follow the file path.', ''
  ];

  for (const section of SECTIONS) {
    const sectionPath = path.join(dossierDir, section);
    if (!fs.existsSync(sectionPath)) { continue; }

    const sectionName = section.replace(/^\d+_/, '').replace(/_/g, ' ');
    lines.push(`## ${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)}`, '', '| Question | File |', '|----------|------|');

    // Default questions
    for (const q of (SECTION_QUESTIONS[section] || [])) {
      lines.push(`| ${q} | ${section}/_MOC.md |`);
    }

    // Entity profiles
    const profilesDir = path.join(sectionPath, 'profiles');
    if (fs.existsSync(profilesDir)) {
      const profiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
      for (const profile of profiles) {
        const name = path.basename(profile, '.md').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        lines.push(`| Tell me about ${name} | ${section}/profiles/${profile} |`);
      }
    }

    // Top-level files
    try {
      const topFiles = fs.readdirSync(sectionPath).filter(f => f.endsWith('.md') && f !== '_MOC.md');
      for (const file of topFiles.slice(0, 10)) {
        const name = path.basename(file, '.md').replace(/_/g, ' ');
        lines.push(`| ${name}? | ${section}/${file} |`);
      }
    } catch {}

    lines.push('');
  }

  writeFile(path.join(dossierDir, 'ROUTER.md'), lines.join('\n'));
}
